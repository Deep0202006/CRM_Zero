"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabaseClient";
import { managementReviewSchema, reviewBucket, REVIEW_BUCKETS, type ManagementReviewReport } from "@/lib/teamKpi/review";
import { Button } from "@/components/ui/Button";
import { ContextRail } from "@/components/workspace/ContextRail";

export default function ManagementReview() {
  const { currentUser, isTaskAssigner } = useAuth(), actor = currentUser?.user_id;
  const [report, setReport] = useState<ManagementReviewReport | null>(null);
  const [employee, setEmployee] = useState(""), [kind, setKind] = useState("tasks"), [bucket, setBucket] = useState("");
  const [selected, setSelected] = useState<string | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState("");
  const pending = useRef<AbortController | null>(null), trigger = useRef<HTMLButtonElement | null>(null);
  const load = useCallback(async (scope: string) => {
    pending.current?.abort();
    const controller = new AbortController(); pending.current = controller;
    setLoading(true); setError("");
    const timer = setTimeout(() => { if (pending.current === controller) { setError("Review took too long. Retry or select one employee."); setLoading(false); controller.abort(); } }, 12000);
    controller.signal.addEventListener("abort", () => clearTimeout(timer), { once: true });
    try {
      const { data } = await supabase.auth.getSession();
      if (controller.signal.aborted) return;
      if (!data.session || data.session.user.id !== actor) throw new Error("Sign in again.");
      const query = new URLSearchParams(scope ? { employee: scope } : {});
      const response = await fetch(`/api/team-kpi/review?${query}`, { headers: { Authorization: `Bearer ${data.session.access_token}` }, cache: "no-store", signal: controller.signal });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || "Current workload unavailable.");
      const parsed = managementReviewSchema.parse(body);
      if ((parsed.employee ?? "") !== scope) throw new Error("Review returned a different employee scope.");
      if (!controller.signal.aborted) { setReport(parsed); setSelected(null); }
    } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Review unavailable."); }
    finally { clearTimeout(timer); if (!controller.signal.aborted) setLoading(false); }
  }, [actor]);
  useEffect(() => { void load(""); return () => pending.current?.abort(); }, [load]);
  const name = (id: string) => report?.cohort.find(member => member.user_id === id)?.name ?? id;
  const task = report?.tasks.records.find(row => row.task_id === selected), target = report?.targets.records.find(row => row.target_id === selected);
  const taskRows = report?.tasks.records.filter(row => !bucket || reviewBucket(row, report.today) === bucket) ?? [];
  const title = task?.title ?? target?.target_name ?? "Current work record";
  return <section className="space-y-3" aria-label="Admin current workload review" aria-busy={loading}>
    <form className="flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); void load(employee); }}>
      <label className="min-w-0 flex-1 text-sm">Current employee<select className="field-control w-full" value={employee} onChange={event => setEmployee(event.target.value)}><option value="">Whole current cohort</option>{report?.cohort.map(member => <option key={member.user_id} value={member.user_id}>{member.name}</option>)}</select></label>
      <Button size="sm" disabled={loading} type="submit">Apply employee</Button><Button size="sm" variant="outline" disabled={loading} onClick={() => void load(report?.employee ?? "")}>Refresh review</Button>
    </form>
    {error && <p role="alert" className="alert-panel alert-panel--danger">{error} {report && "Previous applied workload remains visible."}</p>}
    {loading && <p role="status">Loading current workload…</p>}
    {report && <>
      <header><h2 className="section-title">{report.employee ? name(report.employee) : "Whole current cohort"} · Current workload</h2><p className="text-xs text-[var(--text-secondary)]">Read {new Date(report.generated_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST · Current assignees, not historical completion credit.</p></header>
      <div className="segmented-control" role="group" aria-label="Current workload source">{(["tasks", "targets"] as const).map(value => <button key={value} type="button" aria-pressed={kind === value} onClick={() => { setKind(value); setSelected(null); }}>{value === "tasks" ? "Tasks" : "Allocated targets"} · {report[value].total ?? "Unavailable"}</button>)}</div>
      <div className="workspace-columns"><div className="min-w-0 space-y-3">
        {kind === "tasks" ? <>
          {!report.tasks.complete && <p role="status" className="alert-panel alert-panel--warning">{report.tasks.reason} Shown records are provisional until the source is exhausted.</p>}
          <label className="flex items-center gap-2 text-sm">Due state<select className="field-control" value={bucket} onChange={event => setBucket(event.target.value)}><option value="">All due states</option>{REVIEW_BUCKETS.map(value => <option key={value}>{value}</option>)}</select></label>
          <section className="workspace-register" aria-label="Current task records" data-workspace-register tabIndex={-1}><ol className="divide-y divide-[var(--border-subtle)]">{taskRows.map(row => <li className="workspace-task-row" key={row.task_id}><button className="min-w-0 flex-1 text-left" onClick={event => { trigger.current = event.currentTarget; setSelected(row.task_id); }}><strong className="block break-words text-sm">{row.title}</strong><span className="block text-xs text-[var(--text-secondary)]">{name(row.assigned_to)} · {row.due_date} · {row.priority}</span></button><span className="text-xs">{reviewBucket(row, report.today)}{row.status === "Missed" ? " · read-only" : ""}</span></li>)}</ol>{!taskRows.length && <p className="p-4 text-sm">No matching tasks in this bounded register{report.tasks.complete ? "." : "; full workload is unavailable."}</p>}</section>
          <p className="text-xs">{report.tasks.records.length} task records loaded, at most 50. Due-state filtering applies to these records. Select an employee to narrow.</p>
        </> : <>
          {!report.targets.complete && <p role="status" className="alert-panel alert-panel--warning">{report.targets.reason}</p>}
          <p className="text-xs">Allocated targets have no recorded due date. They are not included in Task totals.</p>
          <section className="workspace-register" aria-label="Allocated target records" data-workspace-register tabIndex={-1}><ol className="divide-y divide-[var(--border-subtle)]">{report.targets.records.map(row => <li className="workspace-task-row" key={row.target_id}><button className="min-w-0 flex-1 text-left" onClick={event => { trigger.current = event.currentTarget; setSelected(row.target_id); }}><strong className="block break-words text-sm">{row.target_name}</strong><span className="block text-xs">{name(row.assigned_to_user_id)} · {row.city} · {row.target_username}</span></button><span className="text-xs">Incomplete</span></li>)}</ol>{!report.targets.records.length && <p className="p-4 text-sm">{report.targets.complete ? "No incomplete targets in this scope." : "Target records unavailable."}</p>}</section>
          <p className="text-xs">{report.targets.records.length} target records loaded, at most 50.</p>
        </>}
        <details className="workspace-disclosure"><summary>Employee workload counts and coverage</summary><p className="text-xs">Live multi-request sources, not an atomic snapshot. Task and target totals are separate; unavailable never means zero. Completed task evidence is read only to resolve existing follow-up duplicates.</p><div className="overflow-auto" tabIndex={0} role="region" aria-label="Current employee workload counts"><table className="w-full text-sm"><thead><tr><th>Employee</th>{REVIEW_BUCKETS.map(value => <th key={value}>{value}</th>)}<th>Targets</th></tr></thead><tbody>{report.employees.map(row => <tr key={row.user_id}><th scope="row">{name(row.user_id)}</th>{REVIEW_BUCKETS.map(value => <td key={value}>{row.tasks?.[value] ?? "Unavailable"}</td>)}<td>{row.targets ?? "Unavailable"}</td></tr>)}</tbody></table></div></details>
      </div><ContextRail open={Boolean(task || target)} title={title} description="Exact current record · Read-only inspection" onClose={() => setSelected(null)} returnFocus={trigger}>
        {task && <><p>Current assignee: {name(task.assigned_to)}</p><p>{task.status} · {reviewBucket(task, report.today)} · Due {task.due_date}</p><p className="break-words">{task.description || "No description recorded."}</p><p className="break-all text-xs">Task ID: {task.task_id}</p>{task.status === "Missed" && <p>Missed is read-only. No completion action is available here.</p>}{task.assigned_to === actor && task.status !== "Missed" && <Link className="underline" href="/my-day">Open your agenda for permitted task actions</Link>}</>}
        {target && <><p>Current assignee: {name(target.assigned_to_user_id)}</p><p>{target.target_username} · {target.city}</p><p>No recorded due date.</p><p className="break-all text-xs">Target ID: {target.target_id}</p></>}
        {isTaskAssigner && <Link className="inline-block min-h-11 underline" href="/manager/tasks">Open existing task assignment</Link>}
      </ContextRail></div>
    </>}
  </section>;
}
