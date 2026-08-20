jest.mock("server-only", () => ({}), { virtual: true });

import fs from "fs";
import path from "path";
import { confirmMasterImport, masterConfirmationRequestHash, MasterConfirmationError } from "@/lib/distributorMaster/confirmation";
import type { MasterImportPreview } from "@/lib/distributorMaster/preview";

const preview = {
  format: "CRM_DISTRIBUTOR_MASTER_V1", operationId: "30000000-0000-4000-a000-000000000001", businessDate: "2026-08-20",
  rows: { distributors: [], receivables: [], payments: [] }, counts: { distributors: {}, receivables: {}, payments: {}, total: 3, blocking: 0 },
  blocking: false, sourcePayloadHash: "b".repeat(64), resolvedPlanHash: "a".repeat(64),
  execution: { distributors: [{ rowNumber: 2, classification: "NEW", payload: { distributor_id: "d" } }], receivables: [{ row_number: 2, receivable_id: "r" }], payments: [{ row_number: 2, payment_id: "p" }] },
} as unknown as MasterImportPreview;

describe("atomic master confirmation", () => {
  test("sends the complete revalidated execution plan through exactly one mutation RPC", async () => {
    const rpc = jest.fn().mockResolvedValue({ data: { success: true, batch_id: "70000000-0000-4000-a000-000000000001", replayed: false }, error: null });
    await expect(confirmMasterImport({ rpc } as never, "10000000-0000-4000-a000-000000000001", "master.xlsx", preview)).resolves.toMatchObject({ success: true });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("import_distributor_master_v1", expect.objectContaining({ p_payload_hash: preview.sourcePayloadHash, p_resolved_plan_hash: preview.resolvedPlanHash, p_distributor_rows: preview.execution.distributors, p_receivable_rows: preview.execution.receivables, p_payment_rows: preview.execution.payments }));
  });

  test("request hash binds filename and every domain execution payload", () => {
    const original = masterConfirmationRequestHash(preview, "master.xlsx");
    expect(original).toMatch(/^[0-9a-f]{64}$/);
    expect(masterConfirmationRequestHash(preview, "other.xlsx")).not.toBe(original);
    expect(masterConfirmationRequestHash({ ...preview, execution: { ...preview.execution, payments: [] } }, "master.xlsx")).not.toBe(original);
  });

  test("typed rejection is terminal while unreadable RPC failure remains uncertain", async () => {
    await expect(confirmMasterImport({ rpc: jest.fn().mockResolvedValue({ data: { success: false, code: "DISTRIBUTOR_CONFLICT" }, error: null }) } as never, "10000000-0000-4000-a000-000000000001", "master.xlsx", preview)).rejects.toMatchObject({ code: "DISTRIBUTOR_CONFLICT", uncertain: false });
    await expect(confirmMasterImport({ rpc: jest.fn().mockResolvedValue({ data: null, error: { code: "NETWORK" } }) } as never, "10000000-0000-4000-a000-000000000001", "master.xlsx", preview)).rejects.toMatchObject({ code: "MASTER_CONFIRMATION_UNCERTAIN", uncertain: true });
    await expect(confirmMasterImport({ rpc: jest.fn() } as never, "actor", "master.xlsx", { ...preview, blocking: true })).rejects.toBeInstanceOf(MasterConfirmationError);
  });

  test("Migration 046 uses one outer subtransaction and rolls back deterministic child failure", () => {
    const sql = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/046_unified_distributor_master_import.sql"), "utf8");
    const start = sql.indexOf("create or replace function public.import_distributor_master_v1");
    const end = sql.indexOf("revoke all on function public.import_distributor_master_v1", start);
    const fn = sql.slice(start, end);
    expect(fn).toContain("pg_advisory_xact_lock");
    expect(fn).toContain("insert into public.distributor_master_import_batches");
    expect(fn).toContain("public.distributor_status_command_v1");
    expect(fn).toContain("case v_distributor_item->>'classification' when 'NEW' then 'create' else 'update' end");
    expect(fn).toContain("public.import_receivables_v1");
    expect(fn).toContain("public.apply_distributor_master_payments_v1");
    expect(fn).toContain("raise exception using errcode='ZD106'");
    expect(fn).toMatch(/exception\s+when sqlstate 'ZD101' or sqlstate 'ZD104' or sqlstate 'ZD106'/);
    expect(fn.indexOf("insert into public.distributor_master_import_batches")).toBeLessThan(fn.indexOf("exception\n    when sqlstate"));
    expect(sql).toContain("enable row level security");
    expect(sql).toContain("grant execute on function public.import_distributor_master_v1");
  });
});
