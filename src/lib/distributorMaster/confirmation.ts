import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolvedMasterPlanHash, type MasterImportPreview } from "./preview";

export interface MasterConfirmationResult {
  success: boolean;
  code?: string;
  batch_id?: string;
  operation_id?: string;
  resolved_plan_hash?: string;
  replayed?: boolean;
  distributors?: Record<string, unknown>;
  receivables?: Record<string, unknown>;
  payments?: Record<string, unknown>;
}

export class MasterConfirmationError extends Error {
  constructor(public readonly code: string, message: string, public readonly uncertain = false) {
    super(message);
    this.name = "MasterConfirmationError";
  }
}

export function masterConfirmationRequestHash(preview: MasterImportPreview, filename: string): string {
  return resolvedMasterPlanHash({
    operationId: preview.operationId,
    resolvedPlanHash: preview.resolvedPlanHash,
    filename: filename.normalize("NFKC").trim(),
    execution: preview.execution,
  });
}

export async function confirmMasterImport(
  service: SupabaseClient,
  actorId: string,
  filename: string,
  preview: MasterImportPreview,
): Promise<MasterConfirmationResult> {
  if (preview.blocking) throw new MasterConfirmationError("MASTER_PLAN_BLOCKED", "The resolved plan contains blocking rows.");
  const requestHash = masterConfirmationRequestHash(preview, filename);
  const { data, error } = await service.rpc("import_distributor_master_v1", {
    p_operation_id: preview.operationId,
    p_actor_id: actorId,
    p_request_hash: requestHash,
    p_payload_hash: preview.sourcePayloadHash,
    p_resolved_plan_hash: preview.resolvedPlanHash,
    p_filename: filename,
    p_distributor_rows: preview.execution.distributors,
    p_receivable_rows: preview.execution.receivables,
    p_payment_rows: preview.execution.payments,
  });
  if (error) throw new MasterConfirmationError("MASTER_CONFIRMATION_UNCERTAIN", "Atomic confirmation did not return an authoritative result.", true);
  const result = data as MasterConfirmationResult | null;
  if (!result?.success) throw new MasterConfirmationError(result?.code ?? "MASTER_CONFIRMATION_REJECTED", "Current authority rejected the atomic confirmation.");
  return result;
}
