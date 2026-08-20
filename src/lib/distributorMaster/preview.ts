import "server-only";
import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getCurrentISTDate } from "@/lib/dateTime";
import { listEligibleOperationalEmployees } from "@/lib/employees/server";
import {
  masterDistributorMutationRows,
  planMasterDistributorRows,
  readMasterDistributorAuthorities,
  type MasterDistributorClassification,
  type PlannedMasterDistributorRow,
} from "./distributors";
import {
  distributorsForMasterReceivables,
  finalizeMasterReceivableFollowUps,
  masterReceivableMutationRows,
  planMasterReceivableRows,
  type MasterReceivableAuthority,
  type MasterReceivableClassification,
  type PlannedMasterReceivableRow,
} from "./receivables";
import {
  masterPaymentMutationRows,
  planMasterPaymentRows,
  targetsForMasterPayments,
  type MasterPaymentClassification,
  type MasterPaymentResolutionRow,
  type PlannedMasterPaymentRow,
} from "./payments";
import { MASTER_WORKBOOK_FORMAT, type ParsedMasterWorkbook } from "./workbook";
import { resolveErpNames } from "@/lib/erp/server";

export type MasterSheetCounts = Record<string, number>;
export type MasterRowAction =
  "CREATE" | "UPDATE" | "CONFIRM" | "SKIP" | "BLOCK";
type WithAction<T> = Omit<T, "classification"> & {
  classification: string;
  action: MasterRowAction;
};

export const MASTER_PREVIEW_CLASSIFICATIONS = {
  distributors: [
    "NEW_DISTRIBUTOR",
    "UPDATE_DISTRIBUTOR",
    "EXACT_DUPLICATE",
    "INVALID_EMPLOYEE",
    "AMBIGUOUS_DISTRIBUTOR",
    "INVALID_DISTRIBUTOR_STATE",
  ],
  receivables: [
    "CREATE_UNPAID_RECEIVABLE",
    "CREATE_PARTIAL_RECEIVABLE",
    "CREATE_PAID_RECEIVABLE",
    "EXACT_DUPLICATE",
    "CONFLICTING_RECEIVABLE",
    "INVALID_DISTRIBUTOR",
    "INVALID_DISTRIBUTOR_STATUS",
  ],
  payments: [
    "CREATE_CONFIRMED_PAYMENT",
    "EXACT_DUPLICATE",
    "CONFLICTING_PAYMENT",
    "PAYMENT_NOT_ELIGIBLE",
    "OVERPAYMENT",
    "FUTURE_PAYMENT_DATE",
    "RECEIVABLE_NOT_FOUND",
  ],
} as const;

export interface MasterImportPreview {
  format: typeof MASTER_WORKBOOK_FORMAT;
  operationId: string;
  businessDate: string;
  rows: {
    distributors: Array<WithAction<PlannedMasterDistributorRow>>;
    receivables: Array<WithAction<PlannedMasterReceivableRow>>;
    payments: Array<WithAction<PlannedMasterPaymentRow>>;
  };
  counts: {
    distributors: MasterSheetCounts;
    receivables: MasterSheetCounts;
    payments: MasterSheetCounts;
    total: number;
    blocking: number;
  };
  blocking: boolean;
  sourcePayloadHash: string;
  resolvedPlanHash: string;
  execution: {
    distributors: ReturnType<typeof masterDistributorMutationRows>;
    receivables: ReturnType<typeof masterReceivableMutationRows> | [];
    payments: ReturnType<typeof masterPaymentMutationRows> | [];
  };
}

export class MasterPlanRevalidationError extends Error {
  constructor(
    public readonly code: "IMPORT_REFRESH_REQUIRED" | "MASTER_PLAN_BLOCKED",
    message: string,
    public readonly preview: MasterImportPreview,
  ) {
    super(message);
    this.name = "MasterPlanRevalidationError";
  }
}

const DISTRIBUTOR_ACTIONS: Record<
  MasterDistributorClassification,
  MasterRowAction
> = {
  NEW: "CREATE",
  UPDATE: "UPDATE",
  EXACT_DUPLICATE: "SKIP",
  INVALID_EMPLOYEE: "BLOCK",
  IDENTITY_CONFLICT: "BLOCK",
};
const RECEIVABLE_ACTIONS: Record<
  MasterReceivableClassification,
  MasterRowAction
> = {
  NEW: "CREATE",
  EXACT_DUPLICATE: "SKIP",
  CONFLICTING_DUPLICATE: "BLOCK",
  INVALID_DISTRIBUTOR: "BLOCK",
  INVALID_DISTRIBUTOR_STATUS: "BLOCK",
  INVALID_EMPLOYEE: "BLOCK",
  INVALID_FOLLOW_UP_DATE: "BLOCK",
};
const PAYMENT_ACTIONS: Record<MasterPaymentClassification, MasterRowAction> = {
  NEW: "CONFIRM",
  EXACT_DUPLICATE: "SKIP",
  CONFLICTING_DUPLICATE: "BLOCK",
  INVALID_RECEIVABLE: "BLOCK",
  INVALID_RECEIVABLE_STATE: "BLOCK",
  FUTURE_PAYMENT_DATE: "BLOCK",
  OVERPAYMENT: "BLOCK",
  NEXT_FOLLOW_UP_REQUIRED: "BLOCK",
};

function normalized(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("en-IN")
    .replace(/\s+/g, " ");
}

function classifications(
  rows: Array<{ classification: string }>,
): MasterSheetCounts {
  const counts: MasterSheetCounts = {};
  for (const row of rows)
    counts[row.classification] = (counts[row.classification] ?? 0) + 1;
  return counts;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  }
  return value;
}

export function resolvedMasterPlanHash(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}

function isDistributorBlocking(row: PlannedMasterDistributorRow): boolean {
  return !["NEW", "UPDATE", "EXACT_DUPLICATE"].includes(row.classification);
}

function isReceivableBlocking(row: PlannedMasterReceivableRow): boolean {
  return !["NEW", "EXACT_DUPLICATE"].includes(row.classification);
}

function isPaymentBlocking(row: PlannedMasterPaymentRow): boolean {
  return !["NEW", "EXACT_DUPLICATE"].includes(row.classification);
}

function distributorPreviewClassification(
  row: PlannedMasterDistributorRow,
): string {
  if (row.classification === "NEW") return "NEW_DISTRIBUTOR";
  if (row.classification === "UPDATE") return "UPDATE_DISTRIBUTOR";
  if (row.classification !== "IDENTITY_CONFLICT") return row.classification;
  return /repeated|multiple|disagree/i.test(row.reason ?? "")
    ? "AMBIGUOUS_DISTRIBUTOR"
    : "INVALID_DISTRIBUTOR_STATE";
}

function receivablePreviewClassification(
  row: PlannedMasterReceivableRow,
  payments: PlannedMasterPaymentRow[],
): string {
  if (row.classification === "NEW") {
    const final = [...payments]
      .reverse()
      .find(
        (payment) =>
          payment.resolvedReceivableId === row.resolvedReceivableId &&
          payment.after,
      );
    if (/^paid$/i.test(final?.after?.paymentState ?? ""))
      return "CREATE_PAID_RECEIVABLE";
    if (/partial/i.test(final?.after?.paymentState ?? ""))
      return "CREATE_PARTIAL_RECEIVABLE";
    return "CREATE_UNPAID_RECEIVABLE";
  }
  if (row.classification === "CONFLICTING_DUPLICATE")
    return "CONFLICTING_RECEIVABLE";
  if (row.classification === "INVALID_EMPLOYEE") return "INVALID_DISTRIBUTOR";
  if (row.classification === "INVALID_FOLLOW_UP_DATE")
    return "INVALID_DISTRIBUTOR_STATUS";
  return row.classification;
}

function paymentPreviewClassification(row: PlannedMasterPaymentRow): string {
  if (row.classification === "NEW") return "CREATE_CONFIRMED_PAYMENT";
  if (row.classification === "CONFLICTING_DUPLICATE")
    return "CONFLICTING_PAYMENT";
  if (row.classification === "INVALID_RECEIVABLE")
    return "RECEIVABLE_NOT_FOUND";
  if (
    ["INVALID_RECEIVABLE_STATE", "NEXT_FOLLOW_UP_REQUIRED"].includes(
      row.classification,
    )
  )
    return "PAYMENT_NOT_ELIGIBLE";
  return row.classification;
}

export async function buildMasterImportPreview(
  service: SupabaseClient,
  workbook: ParsedMasterWorkbook,
  operationId: string,
  businessDate = getCurrentISTDate(),
): Promise<MasterImportPreview> {
  if (workbook.format !== MASTER_WORKBOOK_FORMAT)
    throw new Error("Unsupported master workbook format.");
  const needsEmployees =
    workbook.distributors.length + workbook.receivables.length > 0;
  const directory = needsEmployees
    ? await listEligibleOperationalEmployees(service)
    : { employees: [], error: null };
  if (directory.error) throw directory.error;
  const allReferences = [
    ...new Set(
      [
        ...workbook.distributors,
        ...workbook.receivables,
        ...workbook.payments,
      ].map((row) => row.distributorReference),
    ),
  ];
  const distributorAuthorities = await readMasterDistributorAuthorities(
    service,
    allReferences,
  );
  const erps = await resolveErpNames(
    service,
    workbook.distributors
      .map((row) => row.erpName ?? "")
      .filter((value) => value && value !== "[CLEAR]"),
  );
  const plannedDistributorRows = planMasterDistributorRows(
    operationId,
    workbook.distributors,
    directory.employees,
    distributorAuthorities,
    erps,
  );
  const distributorAuthorityRows = plannedDistributorRows.map((row) => ({
    ...row,
    action: DISTRIBUTOR_ACTIONS[row.classification],
  }));
  const receivableDistributors = distributorsForMasterReceivables(
    distributorAuthorityRows,
    distributorAuthorities,
  );
  const distributorsByReference = new Map(
    receivableDistributors.map((distributor) => [
      normalized(distributor.distributorReference),
      distributor,
    ]),
  );

  const receivableResolutionInput = workbook.receivables.flatMap((row) => {
    const distributor = distributorsByReference.get(
      normalized(row.distributorReference),
    );
    return distributor
      ? [
          {
            row_number: row.rowNumber,
            distributor_id: distributor.distributorId,
            bill_reference_key: normalized(row.billReference),
          },
        ]
      : [];
  });
  let receivableAuthorities: MasterReceivableAuthority[] = [];
  if (receivableResolutionInput.length) {
    const result = await service.rpc(
      "resolve_distributor_master_receivables_v1",
      { p_rows: receivableResolutionInput },
    );
    if (result.error) throw result.error;
    receivableAuthorities = (result.data ?? []) as MasterReceivableAuthority[];
  }
  const provisionalReceivableRows = planMasterReceivableRows(
    operationId,
    workbook.receivables,
    directory.employees,
    receivableDistributors,
    receivableAuthorities,
  );

  const paymentResolutionInput = workbook.payments.flatMap((row) => {
    const distributor = distributorsByReference.get(
      normalized(row.distributorReference),
    );
    return distributor
      ? [
          {
            row_number: row.rowNumber,
            distributor_id: distributor.distributorId,
            bill_reference_key: normalized(row.billReference),
            import_key: normalized(row.paymentImportKey),
          },
        ]
      : [];
  });
  let paymentResolutions: MasterPaymentResolutionRow[] = [];
  if (paymentResolutionInput.length) {
    const result = await service.rpc(
      "resolve_distributor_master_payment_targets_v1",
      { p_rows: paymentResolutionInput },
    );
    if (result.error) throw result.error;
    paymentResolutions = (result.data ?? []) as MasterPaymentResolutionRow[];
  }
  const paymentTargets = targetsForMasterPayments(
    workbook.payments,
    provisionalReceivableRows,
    paymentResolutions,
  );
  const plannedPaymentRows = planMasterPaymentRows(
    workbook.payments,
    paymentTargets,
    businessDate,
  );
  const plannedReceivableRows = finalizeMasterReceivableFollowUps(
    provisionalReceivableRows,
    plannedPaymentRows,
    businessDate,
  );
  const receivableAuthorityRows = plannedReceivableRows.map((row) => ({
    ...row,
    action: RECEIVABLE_ACTIONS[row.classification],
  }));
  const paymentAuthorityRows = plannedPaymentRows.map((row) => ({
    ...row,
    action: PAYMENT_ACTIONS[row.classification],
  }));
  const blockingRows = [
    ...plannedDistributorRows.filter(isDistributorBlocking),
    ...plannedReceivableRows.filter(isReceivableBlocking),
    ...plannedPaymentRows.filter(isPaymentBlocking),
  ];
  const distributorRows = distributorAuthorityRows.map((row) => ({
    ...row,
    classification: distributorPreviewClassification(row),
  }));
  const receivableRows = receivableAuthorityRows.map((row) => ({
    ...row,
    classification: receivablePreviewClassification(row, plannedPaymentRows),
  }));
  const paymentRows = paymentAuthorityRows.map((row) => ({
    ...row,
    classification: paymentPreviewClassification(row),
  }));
  const hashBinding = {
    format: workbook.format,
    operationId,
    businessDate,
    distributors: distributorRows,
    receivables: receivableRows,
    payments: paymentRows,
  };
  const blocking = blockingRows.length > 0;
  const sourcePayloadHash = resolvedMasterPlanHash({
    format: workbook.format,
    distributors: workbook.distributors,
    receivables: workbook.receivables,
    payments: workbook.payments,
  });
  return {
    format: workbook.format,
    operationId,
    businessDate,
    rows: {
      distributors: distributorRows,
      receivables: receivableRows,
      payments: paymentRows,
    },
    counts: {
      distributors: classifications(distributorRows),
      receivables: classifications(receivableRows),
      payments: classifications(paymentRows),
      total: workbook.totalRows,
      blocking: blockingRows.length,
    },
    blocking,
    sourcePayloadHash,
    resolvedPlanHash: resolvedMasterPlanHash(hashBinding),
    execution: {
      distributors: masterDistributorMutationRows(plannedDistributorRows),
      receivables: blocking
        ? []
        : masterReceivableMutationRows(plannedReceivableRows),
      payments: blocking ? [] : masterPaymentMutationRows(plannedPaymentRows),
    },
  };
}

export async function revalidateMasterImportConfirmation(
  service: SupabaseClient,
  workbook: ParsedMasterWorkbook,
  operationId: string,
  expectedResolvedPlanHash: string,
  businessDate = getCurrentISTDate(),
): Promise<MasterImportPreview> {
  const preview = await buildMasterImportPreview(
    service,
    workbook,
    operationId,
    businessDate,
  );
  if (
    !/^[0-9a-f]{64}$/.test(expectedResolvedPlanHash) ||
    preview.resolvedPlanHash !== expectedResolvedPlanHash
  ) {
    throw new MasterPlanRevalidationError(
      "IMPORT_REFRESH_REQUIRED",
      "Current authority changed after preview. Refresh the preview before confirming.",
      preview,
    );
  }
  if (preview.blocking)
    throw new MasterPlanRevalidationError(
      "MASTER_PLAN_BLOCKED",
      "Current authority blocks one or more workbook rows.",
      preview,
    );
  return preview;
}
