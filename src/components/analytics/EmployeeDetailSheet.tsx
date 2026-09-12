"use client";

import type { RefObject } from "react";
import type { TeamKpiResponse } from "@/lib/teamKpi/contract";
import { type HistoryMetric, type HistoryReport } from "@/lib/teamKpi/history";
import { RETAINED_METRICS, retainedChangeLabel } from "@/lib/teamKpi/retainedHistory";
import { RetainedHistoryChart } from "./RetainedHistoryChart";
import { ContextRail } from "@/components/workspace/ContextRail";

export function EmployeeDetailSheet({ report, history, selectedId, onClose, returnFocus, refreshing, error }: {
  report?: TeamKpiResponse;
  history?: HistoryReport;
  metric?: HistoryMetric;
  selectedId: string | null;
  onClose: () => void;
  returnFocus: RefObject<HTMLButtonElement | null>;
  refreshing: boolean;
  error: string | null;
}) {
  const row = report?.rows.find((item) => item.user_id === selectedId);
  const historical = history?.employees.find((item) => item.user_id === selectedId);
  const retained = history?.retained_record_history;
  const personal = retained?.employees.find(item => item.user_id === selectedId);
  const employee = historical ?? row;
  const time = (value: string) => new Date(value).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });
  return <ContextRail open={selectedId !== null} title={employee?.name ?? "Employee unavailable"} description={employee?.role ?? "This employee is no longer available in the current report."} onClose={onClose} returnFocus={returnFocus}>
      <div className="space-y-4">
        {history && <>
          <p>Applied range: <strong>{history.scope.from} to {history.scope.to}</strong> · Asia/Kolkata</p>
          <p className="text-xs text-[var(--text-secondary)]">Last refreshed: {time(history.generated_at)} IST</p>
          {refreshing && <p role="status">Refreshing. The previous applied scope remains visible.</p>}
          {error && <p role="alert">{error} Showing the previous applied scope.</p>}
          {retained && personal && <>
            <h3 className="font-semibold">{RETAINED_METRICS[retained.metric].label}</h3>
            <p>{RETAINED_METRICS[retained.metric].meaning}</p>
            <dl className="space-y-2 tabular-nums"><div><dt>Selected-period retained records</dt><dd>{personal.current?.toLocaleString("en-IN") ?? "Unavailable"}</dd></div><div><dt>Own previous-period retained records ({history.scope.previous_from} to {history.scope.previous_to})</dt><dd>{personal.previous?.toLocaleString("en-IN") ?? "Unavailable"}</dd></div><div><dt>Own period change</dt><dd>{retainedChangeLabel(personal.comparison, personal.previous)}</dd></div></dl>
            <RetainedHistoryChart from={history.scope.from} previousFrom={history.scope.previous_from} values={personal.daily} previousValues={personal.previous_daily} label={RETAINED_METRICS[retained.metric].label} scope={historical?.name ?? "Selected employee"} />
          </>}
          <p>Comparisons describe retained-record counts only, never complete work or productivity. Partial today and mutable Mapping snapshots are not comparable.</p>
          <p>{history.coverage.reason}</p>
          <p>Reference: {history.cohort.count} current internal roster members, including this employee. Not historical membership or a productivity ranking.</p>
          {retained?.metric === "calls_made" && <p>Latest retained call in this range: {historical?.latest_activity_time ? `${time(historical.latest_activity_time)} IST` : "Unavailable"}</p>}
          <p className="text-xs text-[var(--text-secondary)]">Historical tasks, allocated targets, mappings, queries, follow-up subsets and unique completed work are withheld where event meaning or attribution cannot be established.</p>
        </>}
        {report && <>
        <p>Report date: <strong>{report.target_date}</strong> · Asia/Kolkata · Today only</p>
        <p className="text-xs text-[var(--text-secondary)]">Last confirmed refresh: {time(report.generated_at)} IST</p>
        {refreshing && <p role="status">Refreshing. The last confirmed report remains visible.</p>}
        {error && <p role="alert" className="text-[var(--status-danger)]">{error} Showing the last confirmed report.</p>}
        {report.warnings.length > 0 && <div role="status" className="rounded-lg bg-[var(--status-warning-soft)] p-3 text-[var(--status-warning)]"><p>Some sources are incomplete.</p><ul>{report.warnings.map((warning, index) => <li key={`${warning.source}-${index}`}>{warning.message}</li>)}</ul></div>}
        {row && <>
          <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-3">
            <dt>Calls today</dt><dd className="tabular-nums">{row.calls_made.toLocaleString("en-IN")}</dd>
            <dt>Follow-up calls</dt><dd className="tabular-nums">{row.followup_calls.toLocaleString("en-IN")}</dd>
            <dt>Tasks completed</dt><dd className="tabular-nums">{row.tasks_completed.toLocaleString("en-IN")}</dd>
            <dt>Mappings completed</dt><dd className="tabular-nums">{row.mappings_completed.toLocaleString("en-IN")}</dd>
            <dt>Queries resolved</dt><dd className="tabular-nums">{row.queries_handled.toLocaleString("en-IN")}</dd>
            <dt>Unique completed work</dt><dd className="tabular-nums">{row.total_completed_work.toLocaleString("en-IN")}</dd>
            <dt>Attendance</dt><dd>{row.attendance_status}</dd>
          </dl>
          <p>Latest activity: {row.latest_activity_time ? `${time(row.latest_activity_time)} IST` : "No work recorded"}</p>
          <p className="text-xs leading-[18px] text-[var(--text-secondary)]">Tasks completed includes allocated targets. Follow-up calls are a subset of Calls. Linked follow-up call/task pairs count once in daily unique completed work. These are distinct recorded work types, not a productivity score.</p>
        </>}
        </>}
      </div>
  </ContextRail>;
}
