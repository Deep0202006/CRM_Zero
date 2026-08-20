import fs from "node:fs";
import path from "node:path";
import { importPreviewBinding,type ImportBindingRow } from "@/lib/receivables/importBinding";

const distributorId="40000000-0000-4000-a000-000000000001";
const row:ImportBindingRow={rowNumber:2,billReference:"INV-1",distributorName:"Distributor",distributorCode:"DIST-1",contactPerson:"Owner",contactPhone:"999",billAmount:"1000.00",billDueDate:"2026-08-20",nextFollowUpDate:"2026-08-21",assignedEmployeeEmail:"employee@example.com",notes:"",classification:"NEW",business_key:`distributor:${distributorId}|inv-1`,assigned_to:"30000000-0000-4000-a000-000000000001",receivable_id:"20000000-0000-4000-a000-000000000001",distributor_id:distributorId};
const resolved={row_number:2,receivable_id:row.receivable_id,distributor_id:distributorId,bill_reference:"INV-1",distributor_name:"Distributor",distributor_code:"DIST-1",contact_person:"Owner",contact_phone:"999",bill_amount:"1000.00",bill_due_date:"2026-08-20",next_follow_up_date:"2026-08-21",assigned_to:row.assigned_to,notes:""};

describe("canonical Receivables import compatibility",()=>{
 test("binds the resolved distributor UUID into preview identity",()=>{
  const original=JSON.stringify(importPreviewBinding([row],[resolved]));
  const changed="40000000-0000-4000-a000-000000000002";
  expect(JSON.stringify(importPreviewBinding([{...row,distributor_id:changed,business_key:`distributor:${changed}|inv-1`}],[{...resolved,distributor_id:changed}]))).not.toBe(original);
  expect(importPreviewBinding([row],[resolved]).canonicalClassifications[0]).toMatchObject({distributor_id:distributorId,business_identity:`distributor:${distributorId}|inv-1`});
 });

 test("hashes resolved commit rows and preserves the six-argument RPC boundary",()=>{
  const route=fs.readFileSync(path.join(process.cwd(),"src/app/api/receivables/import/route.ts"),"utf8");
  const sql=fs.readFileSync(path.join(process.cwd(),"supabase/migrations/045_distributor_receivable_canonical_link.sql"),"utf8").replace(/\r\n/g,"\n");
  expect(route).toContain("payloadHash=requestHash(preview.resolvedRows)");
  expect(sql).toMatch(/import_receivables_v1\(\s*p_operation_id uuid,p_actor_id uuid,p_request_hash text,p_filename text,p_payload_hash text,p_rows jsonb\s*\)/);
  expect(sql).toContain("v_row:=v_row||jsonb_build_object('distributor_id',v_distributor_id");
  expect(sql).toContain("v_critical:=concat_ws('|',coalesce(v_distributor_id::text,'')");
  expect(sql).toContain("insert into public.receivables(receivable_id,distributor_id,bill_reference");
  expect(sql).toContain("nullif(v_row->>'distributor_id','')::uuid");
 });

 test("validates canonical rows and retains the legacy name/code branch",()=>{
  const sql=fs.readFileSync(path.join(process.cwd(),"supabase/migrations/045_distributor_receivable_canonical_link.sql"),"utf8").replace(/\r\n/g,"\n");
  expect(sql).toContain("where distributor_id=v_distributor_id");
  expect(sql).toContain("'INVALID_DISTRIBUTOR'");
  expect(sql).toContain("'INVALID_DISTRIBUTOR_STATUS'");
  expect(sql).toContain("else\n      if char_length(btrim(v_row->>'distributor_name')) not between 1 and 200");
  expect(sql).toContain("'code:'||lower(btrim(v_row->>'distributor_code')) else 'name:'");
 });
});
