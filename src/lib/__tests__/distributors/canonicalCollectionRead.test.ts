import fs from "node:fs";
import path from "node:path";
import { distributorListSchema } from "@/lib/distributors/validation";

const sql=fs.readFileSync(path.join(process.cwd(),"supabase/migrations/045_distributor_receivable_canonical_link.sql"),"utf8");
const start=sql.indexOf("create or replace function public.distributor_financial_projection_v1");
const end=sql.indexOf("grant execute on function public.distributor_financial_projection_v1",start);
const projection=sql.slice(start,end);

describe("distributor-first canonical collection read model",()=>{
 test("derives money only from canonical receivables and effective payments",()=>{
  expect(projection).toContain("from allowed d\n join public.receivables r on r.distributor_id=d.distributor_id");
  expect(projection).toContain("rp.receivable_id=r.receivable_id");
  expect(projection).toContain("rp.verification_status='confirmed' and rp.reversed_at is null");
  expect(projection).not.toContain("receivables_financial_read_v1");
  expect(projection).not.toMatch(/lead_payment_details|billing_status\s*=\s*'billed'[^\n]+(?:insert|update)/i);
 });

 test("implements exhaustive collection state precedence",()=>{
  const states=["'DISPUTED'","'COLLECTION_SETUP_REQUIRED'","'NOT_BILLED'","'PAID'","'PARTIALLY_PAID'","'UNPAID'"];
  for(const state of states)expect(projection).toContain(state);
  const positions=states.map(state=>projection.indexOf(state));
  expect(positions).toEqual([...positions].sort((left,right)=>left-right));
  expect(projection).toContain("coalesce(bool_or(r.lifecycle_status='disputed') filter(where r.lifecycle_status<>'cancelled'),false)");
  expect(projection).toContain("when f.active_receivable_count=0 and d.billing_status='billed' then 'COLLECTION_SETUP_REQUIRED'");
 });

 test("filters before stable pagination and clamps every page to 50",()=>{
  expect(projection.indexOf("), filtered as (")).toBeLessThan(projection.indexOf("), page_rows as ("));
  expect(projection).toContain("collection_state=p_payment_filter");
  expect(projection).toContain("p_payment_filter='NOT_PAID' and collection_state in ('UNPAID','PARTIALLY_PAID')");
  expect(projection).toContain("billing_status=p_billing_filter");
  expect(projection).toContain("least(greatest(coalesce(p_page_size,50),1),50)");
  expect(projection).toContain("order by updated_at desc,distributor_id desc");
  expect(projection).toContain("offset (select (page-1)*page_size from bounds)");
  expect(distributorListSchema.parse({pageSize:"50"}).pageSize).toBe(50);
  expect(distributorListSchema.safeParse({pageSize:"51"}).success).toBe(false);
 });

 test("enforces active actor scope and keeps the RPC service-only",()=>{
  expect(projection).toContain("u.user_id=p_actor_id and u.is_active=true");
  expect(projection).toContain("public.receivables_is_admin(p_actor_id) or d.assigned_to=p_actor_id");
  expect(sql).toMatch(/revoke all on function public\.distributor_financial_projection_v1[^;]+public,anon,authenticated/);
  expect(sql).toMatch(/grant execute on function public\.distributor_financial_projection_v1[^;]+service_role/);
 });
});
