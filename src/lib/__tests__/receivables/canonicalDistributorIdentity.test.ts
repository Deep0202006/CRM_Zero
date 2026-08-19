import fs from "node:fs";
import path from "node:path";

const read=(file:string)=>fs.readFileSync(path.join(process.cwd(),file),"utf8");
const migration=read("supabase/migrations/045_distributor_receivable_canonical_link.sql");
const resolverStart=migration.indexOf("create function public.resolve_receivable_distributors_v1");
const resolverEnd=migration.indexOf("grant execute on function public.resolve_receivable_distributors_v1",resolverStart);
const resolver=migration.slice(resolverStart,resolverEnd);
const createModal=read("src/components/receivables/ReceivablesCreateModal.tsx");
const importServer=read("src/lib/receivables/importServer.ts");
const importModal=read("src/components/receivables/ReceivablesImportModal.tsx");

describe("canonical Distributor identity intake",()=>{
 test("manual create submits an explicitly selected canonical UUID",()=>{
  expect(createModal).toContain('name="distributor_id" required');
  expect(createModal).toContain("distributor_id: distributor.distributor_id");
  expect(createModal).toContain("assigned_to: distributor.assigned_to");
  expect(createModal).not.toContain('name="assigned_to"');
  expect(createModal).toContain("const distributor=initialDistributor??distributors.find");
  expect(createModal).not.toMatch(/<Input[^>]+name=["']distributor_name["']/);
  expect(migration).toContain("select * into v_distributor from public.distributor_accounts where distributor_id=v_distributor_id");
 });

 test("spreadsheet resolution uses exact reference or exact name equality only",()=>{
  expect(resolver).toContain("case when i.distributor_code is not null then lower(btrim(d.distributor_reference))=lower(i.distributor_code) else lower(btrim(d.distributor_name))=lower(i.distributor_name) end");
  expect(resolver).toContain("when cardinality(ids)>1 then 'AMBIGUOUS_DISTRIBUTOR'");
  expect(resolver).toContain("billing[1]<>'billed' then 'INVALID_DISTRIBUTOR_STATUS'");
  expect(resolver).not.toMatch(/similarity|levenshtein|soundex|metaphone|word_similarity|pg_trgm|\s%\s/i);
 });

 test("preview and commit bind the resolved UUID and canonical display identity",()=>{
  expect(importServer).toContain('service.rpc("resolve_receivable_distributors_v1"');
  expect(importServer).toContain("const canonicalKey=`distributor:${resolved.distributor_id}|${identity.bill}`");
  expect(importServer).toContain("distributor_id:resolved.distributor_id");
  expect(importModal).toContain("row.resolved_distributor_name ?? row.distributorName");
  expect(migration).toContain("insert into public.receivables(receivable_id,distributor_id,bill_reference");
 });

 test("continues to use the shared PR53 Auth employee resolver",()=>{
  expect(importServer).toContain('import { listEligibleOperationalEmployees } from "@/lib/employees/server"');
  expect(importServer).toContain("const directory=await listEligibleOperationalEmployees(service)");
  expect(importServer).not.toMatch(/from\(["']users["']\)|auth\.admin\.listUsers/);
 });
});
