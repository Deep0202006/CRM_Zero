import fs from "node:fs";
import path from "node:path";

const read=(file:string)=>fs.readFileSync(path.join(process.cwd(),file),"utf8");
const payments=read("src/app/admin/payments/page.tsx");
const distributors=read("src/app/admin/payments/distributors/page.tsx");
const migration=read("supabase/migrations/045_distributor_receivable_canonical_link.sql");

describe("Payment Collections additive distributor integration",()=>{
 test("exposes both invoice and distributor collection views",()=>{
  expect(payments).toContain("Distributor Collections");
  expect(payments).toContain("Invoice Receivables");
  expect(distributors).toContain('title="Distributor Collections"');
  expect(distributors).toContain("Invoice Receivables");
  expect(distributors).toContain("row.collection_state");
 });

 test("exposes Total Collected from effective confirmed payments",()=>{
  expect(payments).toContain('["Total Collected",formatInr(summary.total_collected)]');
  expect(migration).toContain("where verification_status='confirmed' and reversed_at is null");
  expect(migration).toContain("'total_collected',coalesce((select sum(amount) from payments),0)::text");
 });

 test("exposes Collection Setup Required without fabricating a receivable",()=>{
  expect(payments).toContain("Collection Setup Required");
  expect(distributors).toContain('<option value="COLLECTION_SETUP_REQUIRED">Collection Setup Required</option>');
  expect(migration).toContain("'collection_setup_required',(select setup_required from collection_setup)");
  expect(migration).toContain("d.billing_status='billed'");
  expect(migration).toContain("not exists(select 1 from public.receivables r where r.distributor_id=d.distributor_id and r.lifecycle_status<>'cancelled')");
 });

 test("retains invoice-level Receivables and exact payment actions",()=>{
  for(const marker of ["fetchReceivables","ReceivablesCreateModal","ReceivablesImportModal","key={r.receivable_id}","Bill Reference","Record payment"])expect(payments).toContain(marker);
  expect(payments).toContain("openDetail(r.receivable_id)");
  expect(payments).toContain("detail.receivable.receivable_id");
 });
});
