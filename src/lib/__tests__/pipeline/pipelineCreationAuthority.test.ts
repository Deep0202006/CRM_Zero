import fs from "node:fs";
import path from "node:path";
import { pipelineCreateCommandFromQueue, type SyncQueueItem } from "../../db";
import { PIPELINE_CREATE_QUEUE_TABLE } from "../../pipeline/contract";

describe("Pipeline single-entry creation authority", () => {
  const migration = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/043_pipeline_creation_authority.sql"), "utf8");
  const owner = fs.readFileSync(path.join(process.cwd(), "owner-043.sql"), "utf8");

  test("owner SQL is the exact pure-PostgreSQL migration", () => {
    expect(owner.replace(/\r\n/g, "\n").trimEnd()).toBe(migration.replace(/\r\n/g, "\n").trimEnd());
    expect(owner).not.toMatch(/^\s*\\/m);
  });

  test("direct authenticated creation is revoked and guarded below React", () => {
    expect(migration).toContain("revoke insert on public.leads from anon, authenticated");
    expect(migration).toContain("trg_guard_pipeline_lead_creation");
    expect(migration).toContain("Lead creation requires the canonical Pipeline create boundary.");
    expect(migration).toContain("grant execute on function public.pipeline_create_lead_v1");
    expect(migration).not.toMatch(/grant execute[\s\S]{0,180}authenticated/i);
  });

  test("duplicate authority includes Converted and uses deterministic identity locks", () => {
    expect(migration).toContain("pg_advisory_xact_lock(v_first_lock)");
    expect(migration).toContain("pipeline_normalize_identity_text(l.business_name) = v_business");
    expect(migration).toContain("pipeline_normalize_phone(l.phone) = v_phone");
    expect(migration).not.toMatch(/where[\s\S]{0,300}status\s*(?:<>|not in)/i);
    expect(migration).toContain("'LEAD_ALREADY_EXISTS'");
  });

  test("migration never rewrites or deletes Lead history and has no cross-domain write", () => {
    const uncommented = migration.replace(/--.*$/gm, "");
    expect(uncommented).not.toMatch(/\b(?:update|delete\s+from|truncate)\s+public\.leads/i);
    expect(uncommented).not.toMatch(/(?:insert\s+into|update|delete\s+from)\s+public\.(tasks|call_logs|attendance|field_visits|receivables|receivable_payments|distributor_accounts|chat_messages)/i);
  });

  test("current semantic durable payload remains stable", () => {
    const operationId = "90000000-0000-4000-a000-000000000001";
    const leadId = "90000000-0000-4000-a000-000000000002";
    const item = {
      idempotency_key: `pipeline-create:${operationId}`,
      owner_user_id: "10000000-0000-4000-a000-000000000001",
      table_name: PIPELINE_CREATE_QUEUE_TABLE,
      action: "INSERT",
      timestamp: "2026-08-15T00:00:00.000Z",
      data: {
        operation_id: operationId, lead_id: leadId,
        actor_id: "10000000-0000-4000-a000-000000000001", business_name: "Business", contact_person: "Person",
        phone: "999", segment_type: "Retailer", lead_source: "Cold Call", area: "Anand", created_at: "2026-08-15T00:00:00.000Z",
      },
    } as SyncQueueItem;
    expect(pipelineCreateCommandFromQueue(item, item.owner_user_id!)).toMatchObject({ operation_id: operationId, lead_id: leadId, actor_id: item.owner_user_id });
  });

  test("previous generic durable payload is normalized into the same command", () => {
    const leadId = "90000000-0000-4000-a000-000000000004";
    const item = {
      idempotency_key: "90000000-0000-4000-a000-000000000003",
      owner_user_id: "10000000-0000-4000-a000-000000000001",
      table_name: "leads",
      action: "INSERT",
      timestamp: "2026-08-14T00:00:00.000Z",
      data: { lead_id: leadId, business_name: "Legacy", contact_person: "Person", phone: "888", segment_type: "Distributor", status: "New", assigned_to: "untrusted", lead_source: "Cold Call", created_at: "2026-08-14T00:00:00.000Z" },
    } as SyncQueueItem;
    expect(pipelineCreateCommandFromQueue(item, item.owner_user_id!)).toMatchObject({ operation_id: item.idempotency_key, actor_id: item.owner_user_id, lead_id: leadId });
  });

  test("terminal creates become passive and transient creates have a finite retry ceiling", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/lib/db.ts"), "utf8");
    expect(source).toContain('result.status === "duplicate" || result.status === "rejected"');
    expect(source).toContain('recovery_state: "review_required"');
    expect(source).toContain("retryCount >= 8");
    expect(source).toContain('last_error: "PIPELINE_CREATE_RETRY_EXHAUSTED"');
  });
});
