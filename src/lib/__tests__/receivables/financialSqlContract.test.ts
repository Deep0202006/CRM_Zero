import fs from "fs"; import path from "path";
const read=(p:string)=>fs.readFileSync(path.join(process.cwd(),p),"utf8"); const sql=read("supabase/migrations/033_receivables_v1.sql");
describe("receivables database financial/concurrency contract",()=>{
 test("confirmed-only numeric read model derives payment state and no negative balance",()=>{expect(sql).toContain("filter(where verification_status='confirmed')");expect(sql).toMatch(/bill_amount-coalesce\(m\.confirmed_paid_amount,0\)/);expect(sql).toContain("payment_state");expect(sql).toContain("v_payment.amount>v_r.bill_amount-v_paid")});
 test("all existing-record commands lock and version-check",()=>{expect(sql).toMatch(/for update;[\s\S]*RECEIVABLE_CONFLICT/);expect(sql).toContain("version=version+1");expect(sql).toContain("pg_advisory_xact_lock");});
 test("idempotency binds operation, actor, type and request hash",()=>{expect(sql).toMatch(/v_receipt\.actor_id<>p_actor_id[\s\S]*v_receipt\.operation_type<>p_operation_type[\s\S]*v_receipt\.request_hash<>p_request_hash/);expect(sql).toContain("RECEIVABLE_OPERATION_MISMATCH")});
 test("reports do not reduce balance and reversal preserves history",()=>{expect(sql).toContain("verification_status='reported'");expect(sql).toContain("verification_status='reversed'");expect(sql).not.toMatch(/delete\s+from\s+public\.receivable/i)});
 test("latest operational event supersedes stale promise",()=>{expect(sql).toMatch(/distinct on\(receivable_id\)[\s\S]*event_type in \('followup_contacted','followup_no_response','promise_to_pay'/)});
 test("service-only functions and browser read-only grants",()=>{expect(sql).toMatch(/revoke all on function public\.execute_receivable_command_v1.*authenticated/);expect(sql).toMatch(/grant execute on function public\.execute_receivable_command_v1.*service_role/);expect(sql).not.toMatch(/grant\s+(insert|update|delete).*authenticated/i)});
 test("import is bounded, transactional, active-user resolved and retry-stable",()=>{expect(sql).toContain("jsonb_array_length(p_rows)>5000");expect(sql).toContain("IMPORT_EMPLOYEE_CHANGED");expect(sql).toContain("IMPORT_REFRESH_REQUIRED");expect(sql).toContain("receivable_import_batches")});
});
