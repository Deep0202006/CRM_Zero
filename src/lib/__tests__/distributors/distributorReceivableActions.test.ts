import fs from "node:fs";
import path from "node:path";

const read=(file:string)=>fs.readFileSync(path.join(process.cwd(),file),"utf8");
const page=read("src/app/admin/payments/distributors/page.tsx");
const createModal=read("src/components/receivables/ReceivablesCreateModal.tsx");
const route=read("src/app/api/distributors/[id]/receivables/route.ts");
const migration=read("supabase/migrations/045_distributor_receivable_canonical_link.sql");
const functionStart=migration.indexOf("create or replace function public.distributor_outstanding_receivables_v1");
const functionEnd=migration.indexOf("grant execute on function public.distributor_outstanding_receivables_v1",functionStart);
const outstandingRpc=migration.slice(functionStart,functionEnd);

describe("Distributor Status Receivables actions",()=>{
 test("renders canonical collection facts as read-only columns",()=>{
  expect(page).toMatch(/\[\s*"Distributor Name",\s*"ERP",\s*"Assigned Employee"/);
  expect(page).toContain("row.collection_state");
  expect(page).toMatch(/formatInr\(row\.confirmed_collected_amount\s*\?\?\s*"0.00"\)/);
  expect(page).toMatch(/formatInr\(row\.outstanding_amount\s*\?\?\s*"0.00"\)/);
  expect(page).not.toMatch(/name=["'](?:confirmed_collected_amount|outstanding_amount|collection_state)["']/);
 });

 test("reuses canonical Receivables create and payment commands",()=>{
  expect(page).toContain("<ReceivablesCreateModal");
  expect(page).toMatch(/<AdminReceivableActionModal\s+action="direct_payment"/);
  expect(page).toMatch(/operation_type:\s*"create"/);
  expect(page).toMatch(/operation_type:\s*"direct_payment"/);
  expect(page).toMatch(/receivable_id:\s*paymentTarget\.receivable_id/);
  expect(page).toMatch(/expected_version:\s*paymentTarget\.version/);
  expect(createModal).toContain('name="distributor_id" value={initialDistributor.distributor_id}');
  expect(createModal).toContain("const distributor=initialDistributor??distributors.find");
 });

 test("requires exact selection when a distributor has multiple outstanding receivables",()=>{
  expect(page).toMatch(/if \(Number\(result\.total\) === 1\)[\s\S]*setPaymentTarget\(exact\[0\]\);[\s\S]*return;/);
  expect(page).toContain('title="Select exact Receivable"');
  expect(page).toContain("key={candidate.receivable_id}");
  expect(page).toContain("setPaymentTarget(candidate)");
  expect(page).toContain("Showing the first 50 outstanding invoices");
 });

 test("loads only a bounded, authorized canonical exact-target list",()=>{
  expect(route).toContain("const {id}=await routeContext.params");
  expect(route).toContain('context.service.rpc("distributor_outstanding_receivables_v1"');
  expect(route).toContain("p_distributor_id:id,p_limit:50");
  expect(outstandingRpc).toContain("d.distributor_id=p_distributor_id");
  expect(outstandingRpc).toContain("public.receivables_is_admin(p_actor_id) or d.assigned_to=p_actor_id");
  expect(outstandingRpc).toContain("join public.receivables r on r.distributor_id=d.distributor_id");
  expect(outstandingRpc).toContain("join public.receivables_financial_read_v1 f on f.receivable_id=r.receivable_id");
  expect(outstandingRpc).toContain("limit least(greatest(coalesce(p_limit,50),1),50)");
  expect(migration).toMatch(/revoke all on function public\.distributor_outstanding_receivables_v1[^;]+public,anon,authenticated/);
  expect(migration).toMatch(/grant execute on function public\.distributor_outstanding_receivables_v1[^;]+service_role/);
 });
});
