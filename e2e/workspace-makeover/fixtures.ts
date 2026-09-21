import { expect, type Page } from "@playwright/test";
import { addISTDateDays, getCurrentISTDate } from "../../src/lib/dateTime";
import { buildTeamKpiReport } from "../../src/lib/teamKpi/aggregate";
import { buildHistoryReport, parseHistoryScope } from "../../src/lib/teamKpi/history";
import { parseVisitSummary, visitSummaryReportSchema } from "../../src/lib/fieldVisits/range";

export const actor = "91000000-0000-4000-a000-000000000001";
export const employee = "92000000-0000-4000-a000-000000000001";
export const today = getCurrentISTDate();
export const leads = ["Acme Medical and General Stores", "Bright Care Distributors", "Cedar Pharmacy", "Dawn Healthcare"].map((business_name, i) => ({ lead_id: `93000000-0000-4000-a000-00000000000${i + 1}`, business_name, contact_person: ["Riya Shah", "Dev Patel", "Kavita Rao", "Amir Khan"][i], phone: "9990000000", segment_type: "Retailer", status: ["New", "Contacted", "Interested", "Registration"][i], assigned_to: i === 0 ? actor : employee, owner_name: i === 0 ? "Asha Mehta" : "Nikhil Rao", lead_source: "Referral", area: "Pune", created_at: `${today}T03:00:00Z` }));
export const tasks = ["Confirm the recorded visit follow-up", "Review the assigned client documents", "Prepare the upcoming field route", "Send the completed service update"].map((title, i) => ({ task_id: `94000000-0000-4000-a000-00000000000${i + 1}`, assigned_to: actor, assigned_by: actor, title, description: "Existing assigned work. Review the linked record before acting.", priority: i === 0 ? "High" : "Medium", status: i === 3 ? "Completed" : "Pending", source: "manual", related_lead_id: i === 0 ? leads[0].lead_id : null, due_date: addISTDateDays(today, i === 0 ? -1 : i === 2 ? 2 : 0), created_at: `${today}T02:00:00Z`, completed_at: i === 3 ? `${today}T04:00:00Z` : null, is_active: true }));
export const visits = leads.map((lead, i) => ({ visit_id: `95000000-0000-4000-a000-00000000000${i + 1}`, lead_id: lead.lead_id, user_id: actor, visit_date: today, check_in_time: `${today}T0${i + 2}:00:00Z`, segment_type: i === 1 ? "Distributor" : "Retailer", visit_outcome: ["follow_up", "payment_done", "interested", "legacy_unknown"][i], visit_notes: "Discussed the existing service request; next step recorded.", person_met: lead.contact_person, address: "12 Market Road, Pune", pincode: "411001", follow_up_date: i === 0 ? today : null, selfie_status: i === 0 ? "AVAILABLE" : "PURGED", erp_usage_state: i === 0 ? "none" : null, leads: lead, users: { name: "Asha Mehta", email: "asha@example.test" } }));
const users = [{ user_id: actor, name: "Asha Mehta", is_active: true }, { user_id: employee, name: "Nikhil Rao — Field Operations", is_active: true }];
const calls = Array.from({ length: 17 }, (_, i) => ({ log_id: `call-${i}`, user_id: i < 10 ? actor : employee, timestamp: `${addISTDateDays(today, -(i % 4))}T04:00:00Z`, outcome: "Connected" }));
export const report = buildTeamKpiReport({ targetDate: today, users, userCapabilities: users.map(u => ({ user_id: u.user_id, capability_code: "field_ret" })), capabilities: [{ code: "field_ret", label: "Field" }], calls, tasks: [], taskHistory: [], mappings: [], clientQueries: [], attendance: [], allocatedTargets: [] });

export function buildVisitSummary(params: URLSearchParams, rows: typeof visits) {
  const generated_at = new Date().toISOString(), scope = parseVisitSummary(params, generated_at);
  const outcomes = { registered: 0, installed: 0, interested: 0, follow_up: 0, payment_follow_up: 0, payment_done: 0, not_interested: 0 };
  let unknown_outcome_count = 0;
  for (const row of rows) if (row.visit_outcome in outcomes) outcomes[row.visit_outcome as keyof typeof outcomes]++; else unknown_outcome_count++;
  const dates = rows.map(row => row.visit_date).sort(), scope_start_date = scope.date_from ?? dates[0] ?? null, scope_end_date = scope.date_to ?? dates.at(-1) ?? null;
  const span = scope_start_date && scope_end_date ? Math.round((Date.parse(`${scope_end_date}T00:00:00Z`) - Date.parse(`${scope_start_date}T00:00:00Z`)) / 86_400_000) + 1 : 0;
  const bucket_days = span ? Math.max(1, Math.ceil(span / 366)) : null;
  const activity = bucket_days ? Array.from({ length: Math.ceil(span / bucket_days) }, (_, index) => {
    const start_date = addISTDateDays(scope_start_date!, index * bucket_days), end_date = [addISTDateDays(start_date, bucket_days - 1), scope_end_date!].sort()[0];
    return { start_date, end_date, count: rows.filter(row => row.visit_date >= start_date && row.visit_date <= end_date).length };
  }) : [];
  const representativeCounts = new Map<string, number>(); for (const row of rows) representativeCounts.set(row.user_id, (representativeCounts.get(row.user_id) ?? 0) + 1);
  return visitSummaryReportSchema.parse({ kind: "visit-summary-v1", schema_version: 1, scope, generated_at, retained_source_read: "aggregated", historical_coverage: "uncertified", consistency: "single-statement-snapshot",
    filtered_total: rows.length, outcomes, unknown_outcome_count, scope_start_date, scope_end_date, bucket_days, activity, date_mismatch_count: 0,
    representatives: [...representativeCounts].map(([user_id, count]) => ({ user_id, name: rows.find(row => row.user_id === user_id)?.users?.name ?? null, count })), representative_breakdown: "exhausted" });
}

export async function setup(page: Page, empty = false) {
  const requests: string[] = [];
  page.on("request", request => { if (new URL(request.url()).pathname.startsWith("/api/")) requests.push(new URL(request.url()).pathname + new URL(request.url()).search); });
  await page.route("http://127.0.0.1:54321/**", route => route.fulfill({ json: [] }));
  await page.route("http://127.0.0.1:54321/auth/v1/user", route => route.fulfill({ json: { id: actor, aud: "authenticated", role: "authenticated", email: "asha@example.test", app_metadata: {}, user_metadata: {} } }));
  await page.route("**/api/my-day/daily-summary", route => route.fulfill({ json: { genuine_calls_today: 5, followup_calls_today: 0, confirmed_genuine_call_ids: [], confirmed_followup_call_ids: [], total_tasks_completed_today: 1, unique_completed_work: 6, generated_at: new Date().toISOString() } }));
  await page.route("**/api/my-day/payment-followups", route => route.fulfill({ json: { reminders: [] } }));
  await page.route("**/api/my-day/receivables", route => route.fulfill({ json: { items: [], generated_at: new Date().toISOString() } }));
  await page.route("**/api/admin/visits?**", route => route.fulfill({ json: { visits: empty ? [] : visits, page: 1, has_more: false, total: empty ? 0 : visits.length, all_time_total: 127, today_total: 12, representatives: [{ user_id: actor, name: "Asha Mehta", email: "asha@example.test", is_active: true, capabilities: [], historical_only: false }], legacy_date_mismatch_count: 0 } }));
  await page.route("**/api/admin/visits/analysis?**", route => {
    const params = new URL(route.request().url()).searchParams, scope = parseVisitSummary(params, new Date().toISOString());
    const rows = empty ? [] : visits.filter(row => (!scope.date_from || row.visit_date >= scope.date_from) && (!scope.date_to || row.visit_date <= scope.date_to) && (!scope.representative || row.user_id === scope.representative) && (!scope.outcome || row.visit_outcome === scope.outcome) && (!scope.segment || row.segment_type === scope.segment)
      && (!scope.search || [row.users.name, row.users.email, row.leads.business_name, row.leads.contact_person, row.leads.phone, row.visit_notes, row.person_met, row.address].some(value => value?.toLowerCase().includes(scope.search.toLowerCase()))));
    return route.fulfill({ json: buildVisitSummary(params, rows) });
  });
  await page.route("**/api/team-kpi**", route => { const params = new URL(route.request().url()).searchParams; const scope = parseHistoryScope(params, new Date().toISOString()); return route.fulfill({ json: scope ? buildHistoryReport({ scope, members: report.rows, calls: empty ? [] : calls, generatedAt: new Date().toISOString(), requests: 4 }) : report }); });
  await page.route("**/api/pipeline/leads?**", route => { const segment = new URL(route.request().url()).searchParams.get("segment") ?? "Retailer"; return route.fulfill({ json: { leads: empty ? [] : leads.map(lead => ({ ...lead, segment_type: segment })), recovery: { operations: [], safe_replay_targets: [] }, page: 1, pageSize: 50, total: empty ? 0 : leads.length, has_more: false, stages: ["New", "Contacted", "Interested", "Registration"].map(stage => ({ stage, count: empty ? 0 : leads.filter(lead => lead.status === stage).length })) } }); });
  await page.route("**/api/pipeline/leads/*/context", route => { const lead = leads.find(l => route.request().url().includes(l.lead_id))!; return route.fulfill({ json: { lead, stage_age_days: 3, transitions: [], next_task: { title: "Review exact lead documents", due_date: today }, overdue_tasks: [], recent_tasks: [], latest_call: null, recent_calls: [] } }); });
  await page.route("**/api/pipeline/inspection?**", route => route.fulfill({ json: { scope: { page_size: 50, matched_total: empty ? 0 : leads.length, generated_at: new Date().toISOString() }, stages: ["New", "Contacted", "Interested", "Registration"].map(stage => ({ stage, count: empty ? 0 : 1 })), sources: [{ source: "Referral", total: 4, converted: 1, rate: 25, reconciled: true }], current_stage_age: [{ stage: "Contacted", average_days: 3.5 }], historical_velocity: { rows: [{ stage: "Contacted", p50_days: 2.5, average_days: 3.25, sample_n: 8 }], sample_n: 8, coverage_n: 10, coverage_pct: 80 }, history: { weeks: Array.from({ length: 12 }, (_, i) => ({ period: `W${i + 1}`, new_leads: i % 5, successes: i % 2, movements: i % 3, advanced: i % 2, regressed: 0 })), months: [], lead_sample_n: 4, transition_sample_n: 8, coverage: "Sampled event history, up to 2,000 leads and transitions.", lead_sample_limited: false, transition_sample_limited: false }, owner_options: users, leads: empty ? [] : leads.map(lead => ({ ...lead, stage_age_days: 3, attention_reasons: [], next_task: null, recent_call: null })) } }));
  await page.goto("/login"); await expect(page.getByText("Sign in to your account")).toBeVisible({ timeout: 30_000 });
  await page.evaluate(async ({ actor, tasks, empty }) => {
    const request = indexedDB.open("CRMDatabase"); const database = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const tx = database.transaction(["users", "user_capabilities", "tasks"], "readwrite");
    tx.objectStore("users").put({ user_id: actor, name: "Asha Mehta", email: "asha@example.test", is_active: 1, created_at: new Date().toISOString() });
    ["admin", "ret_onboarding"].forEach(code => tx.objectStore("user_capabilities").put({ id: `${actor}-${code}`, user_id: actor, capability_code: code, assigned_at: new Date().toISOString() }));
    if (!empty) tasks.forEach(task => tx.objectStore("tasks").put(task));
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); database.close();
    const encode = (value: unknown) => btoa(JSON.stringify(value)).replaceAll("=", "");
    localStorage.setItem("authenticated_user_id", actor); localStorage.setItem("sb-127-auth-token", JSON.stringify({ access_token: `${encode({ alg: "none" })}.${encode({ sub: actor, exp: 1999999999 })}.e2e`, refresh_token: "e2e", expires_at: 1999999999, expires_in: 999999999, token_type: "bearer", user: { id: actor, aud: "authenticated", role: "authenticated", email: "asha@example.test", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } }));
  }, { actor, tasks, empty });
  return requests;
}
