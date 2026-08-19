import fs from "node:fs";
import path from "node:path";
import { parseReceivableCommand } from "@/lib/receivables/validation";

const operationId="10000000-0000-4000-a000-000000000001";
const receivableId="20000000-0000-4000-a000-000000000001";
const assigneeId="30000000-0000-4000-a000-000000000001";
const distributorId="40000000-0000-4000-a000-000000000001";
const base={receivable_id:receivableId,bill_reference:"INV-1",contact_person:"Owner",bill_amount:"1000.00",bill_due_date:"2026-08-20",next_follow_up_date:"2026-08-21",assigned_to:assigneeId};

describe("canonical Receivables create compatibility",()=>{
 test("accepts canonical UUID and legacy name payloads while rejecting neither identity",()=>{
  expect(parseReceivableCommand({operation_id:operationId,operation_type:"create",payload:{...base,distributor_id:distributorId}}).success).toBe(true);
  expect(parseReceivableCommand({operation_id:operationId,operation_type:"create",payload:{...base,distributor_name:"Legacy Distributor"}}).success).toBe(true);
  expect(parseReceivableCommand({operation_id:operationId,operation_type:"create",payload:base}).success).toBe(false);
  expect(parseReceivableCommand({operation_id:operationId,operation_type:"create",payload:{...base,distributor_id:"not-a-uuid"}}).success).toBe(false);
 });

 test("preserves the RPC signature and validates then persists the canonical identity",()=>{
  const sql=fs.readFileSync(path.join(process.cwd(),"supabase/migrations/045_distributor_receivable_canonical_link.sql"),"utf8");
  expect(sql).toMatch(/execute_receivable_command_v1\(\s*p_operation_id uuid,p_operation_type text,p_actor_id uuid,p_request_hash text,p_payload jsonb\s*\)/);
  expect(sql).toContain("where distributor_id=v_distributor_id");
  expect(sql).toContain("'INVALID_DISTRIBUTOR'");
  expect(sql).toContain("'INVALID_DISTRIBUTOR_STATUS'");
  expect(sql).toContain("receivable_id,distributor_id,bill_reference");
  expect(sql).toContain("values((p_payload->>'receivable_id')::uuid,v_distributor_id");
  expect(sql).toContain("when v_distributor_id is not null then v_distributor.distributor_name");
  expect(sql).toContain("v_assigned_to:=v_distributor.assigned_to");
  expect(sql).toContain("v_assigned_to,'manual',p_actor_id");
 });
});
