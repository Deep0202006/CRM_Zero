import { getISTDateKey } from "@/lib/dateTime";
import { canonicalMoney } from "@/lib/receivables/domain";
import { MAX_IMPORT_ROWS,parseReceivablesTable } from "@/lib/receivables/import";
import { parseReceivableCommand } from "@/lib/receivables/validation";
import { isRetryableReceivableFailure,receivablesOutboxKey } from "@/lib/receivables/client";

const id="11111111-1111-4111-8111-111111111111",receivable="22222222-2222-4222-8222-222222222222";
describe("receivables CTO hardening contracts",()=>{
 test.each([["2026-08-10T18:31:00Z","2026-08-11"],["2026-08-10T23:29:00Z","2026-08-11"],["2026-08-11T00:00:00Z","2026-08-11"],["2026-08-11T18:29:00Z","2026-08-11"]])("uses IST business date at boundary %s",(instant,date)=>expect(getISTDateKey(instant)).toBe(date));
 test.each(["₹84,500","84,500","84500","84500.00"])("normalizes shared money input %s",value=>expect(canonicalMoney(value)).toBe("84500.00"));
 test("strict command schemas reject unknown operations, extra fields, malformed UUIDs, and oversized notes",()=>{
  expect(parseReceivableCommand({operation_id:id,operation_type:"delete",payload:{}}).success).toBe(false);
  expect(parseReceivableCommand({operation_id:id,operation_type:"contacted",payload:{receivable_id:receivable,expected_version:1,next_follow_up_date:"2026-08-12",forged_admin:true}}).success).toBe(false);
  expect(parseReceivableCommand({operation_id:id,operation_type:"contacted",payload:{receivable_id:"bad",expected_version:1,next_follow_up_date:"2026-08-12"}}).success).toBe(false);
  expect(parseReceivableCommand({operation_id:id,operation_type:"contacted",payload:{receivable_id:receivable,expected_version:1,next_follow_up_date:"2026-08-12",note:"x".repeat(1001)}}).success).toBe(false);
 });
 test("requires a structurally valid initial follow-up date",()=>{
  const base={receivable_id:receivable,bill_reference:"INV",distributor_name:"ABC",distributor_code:"",contact_person:"A",contact_phone:"",bill_amount:"1000.00",bill_due_date:"2026-08-10",assigned_to:id,note:""};
  for(const next_follow_up_date of [null,""])expect(parseReceivableCommand({operation_id:id,operation_type:"create",payload:{...base,next_follow_up_date}}).success).toBe(false);
  expect(parseReceivableCommand({operation_id:id,operation_type:"create",payload:{...base,next_follow_up_date:"2026-08-11"}}).success).toBe(true);
 });
 test("classifies only uncertain/transient responses for retry and scopes recovery by account",()=>{
  expect(isRetryableReceivableFailure(undefined)).toBe(true);expect(isRetryableReceivableFailure(503)).toBe(true);
  expect(isRetryableReceivableFailure(400)).toBe(false);expect(isRetryableReceivableFailure(403)).toBe(false);expect(isRetryableReceivableFailure(409)).toBe(false);
  expect(receivablesOutboxKey("employee-a")).not.toBe(receivablesOutboxKey("employee-b"));
 });
 test("parses the 5,000-row chaos ceiling without quadratic duplicate scans",()=>{
  const headers=["Bill Reference","Distributor Name","Contact Person","Contact Phone","Bill Amount","Bill Due Date","Payment Follow-up Date","Assigned Employee Email","Distributor Code","Notes"];
  const rows=Array.from({length:MAX_IMPORT_ROWS},(_,i)=>[` INV-${i} `,i%2?"कंपनी वितरण":"Unicode Distributors","Contact",i%3?"":"9999999999",i%4===0?"₹84,500":i%4===1?"84,500":"84500.00",i%3===0?"2026-08-01":i%3===1?"01/08/2026":"01-08-2026","2026-08-12","employee@example.com",i%2?`CODE-${i}`:"",""]);
  const result=parseReceivablesTable([headers,...rows]);expect(result.rows).toHaveLength(MAX_IMPORT_ROWS);expect(result.invalid).toHaveLength(0);
 });
});
