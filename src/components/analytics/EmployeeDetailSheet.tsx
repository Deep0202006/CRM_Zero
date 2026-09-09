"use client";

import type { RefObject } from "react";
import type { TeamKpiResponse } from "@/lib/teamKpi/contract";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/Sheet";

export function EmployeeDetailSheet({ report, selectedId, onClose, returnFocus, refreshing, error }: {
  report: TeamKpiResponse;
  selectedId: string | null;
  onClose: () => void;
  returnFocus: RefObject<HTMLButtonElement | null>;
  refreshing: boolean;
  error: string | null;
}) {
  const row = report.rows.find((item) => item.user_id === selectedId);
  const time = (value: string) => new Date(value).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });
  return <Sheet open={selectedId !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
    <SheetContent onCloseAutoFocus={(event) => { event.preventDefault(); if (returnFocus.current?.isConnected) returnFocus.current.focus(); else document.getElementById("kpi-table-title")?.focus(); }}>
      <SheetHeader className="pr-14 sm:p-6 sm:pr-16">
        <SheetTitle className="break-words text-lg leading-[26px]">{row?.name ?? "Employee unavailable"}</SheetTitle>
        <SheetDescription>{row?.role ?? "This employee is no longer available in the current report. Close this detail and choose a current employee."}</SheetDescription>
      </SheetHeader>
      <div className="space-y-4 px-4 pb-6 text-sm sm:px-6">
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
      </div>
    </SheetContent>
  </Sheet>;
}
