"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, CalendarDays, CheckCircle2, Download, ShieldAlert, User as UserIcon } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabaseClient";
import { getCurrentISTDate } from "@/lib/dateTime";
import { resolveAttendanceDay, type AttendanceAuthorityRow } from "@/lib/attendance/authority";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Input } from "@/components/ui/Input";
import { PageHeader } from "@/components/ui/PageHeader";
import { MetricCard } from "@/components/ui/MetricCard";
import { EmptyState } from "@/components/ui/EmptyState";

type Period = "daily" | "weekly" | "monthly";
type Staff = { user_id: string; name: string; capabilities: string[] };
type Report = { date_from: string; date_to: string; users: Staff[]; attendance: AttendanceAuthorityRow[] };

function shiftDate(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function periodRange(period: Period, selectedDate: string) {
  if (period === "daily") return { dateFrom: selectedDate, dateTo: selectedDate };
  if (period === "weekly") return { dateFrom: shiftDate(selectedDate, -6), dateTo: selectedDate };
  return { dateFrom: `${selectedDate.slice(0, 7)}-01`, dateTo: selectedDate };
}

function dateKeys(from: string, to: string) {
  const keys: string[] = [];
  for (let key = from; key <= to; key = shiftDate(key, 1)) keys.push(key);
  return keys;
}

function evidenceLabel(state: ReturnType<typeof resolveAttendanceDay>["evidence_state"]) {
  if (state === "purged") return "Selfie expired";
  if (state === "available") return "Selfie recorded";
  return "Legacy/system evidence";
}

function formatTime(value: string | null) {
  return value ? new Date(value).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" }) : "—";
}

function csvCell(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

export default function AdminAttendancePage() {
  const { isAdmin } = useAuth();
  const [period, setPeriod] = useState<Period>("daily");
  const [selectedDate, setSelectedDate] = useState(getCurrentISTDate());
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const requestGeneration = useRef(0);
  const range = useMemo(() => periodRange(period, selectedDate), [period, selectedDate]);

  const loadData = useCallback(async () => {
    const generation = ++requestGeneration.current;
    setLoading(true);
    setError("");
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session?.access_token) throw new Error("Authentication required");
      const response = await fetch(`/api/admin/attendance?date_from=${range.dateFrom}&date_to=${range.dateTo}`, {
        headers: { Authorization: `Bearer ${data.session.access_token}` },
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Authoritative attendance unavailable");
      const next = await response.json() as Report;
      if (generation !== requestGeneration.current) return;
      if (next.date_from !== range.dateFrom || next.date_to !== range.dateTo) throw new Error("Attendance range mismatch");
      setReport(next);
    } catch {
      if (generation === requestGeneration.current) {
        setReport(null);
        setError("Team attendance could not refresh from the authoritative server. No attendance status is being inferred.");
      }
    } finally {
      if (generation === requestGeneration.current) setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    let timer: number | null = window.setTimeout(() => { timer = null; void loadData(); }, 0);
    const schedule = () => {
      if (document.visibilityState !== "visible" || timer != null) return;
      timer = window.setTimeout(() => { timer = null; void loadData(); }, 250);
    };
    const channel = supabase.channel("admin-attendance-authority")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "attendance" }, schedule)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "attendance" }, schedule)
      .subscribe();
    return () => {
      requestGeneration.current += 1;
      if (timer != null) window.clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [loadData]);

  const days = useMemo(() => dateKeys(range.dateFrom, range.dateTo), [range]);
  const dailyRows = useMemo(() => report?.users.map((user) => ({ user, resolved: resolveAttendanceDay(report.attendance, user.user_id, selectedDate) })) ?? [], [report, selectedDate]);
  const summaries = useMemo(() => report?.users.map((user) => {
    const resolutions = days.map((day) => ({ day, value: resolveAttendanceDay(report.attendance, user.user_id, day) }));
    const present = resolutions.filter(({ value }) => value.present);
    return { user, daysPresent: present.length, lastSeen: present.at(-1)?.day ?? null };
  }) ?? [], [days, report]);
  const presentCount = dailyRows.filter(({ resolved }) => resolved.present).length;
  const attendanceRecords = report?.attendance.length ?? 0;

  const exportCSV = () => {
    if (!report) return;
    const lines = [["Date", "User ID", "Name", "Role", "Clock In", "Clock Out", "Status", "Evidence"]];
    for (const user of report.users) for (const day of days) {
      const resolved = resolveAttendanceDay(report.attendance, user.user_id, day);
      lines.push([day, user.user_id, user.name, user.capabilities.join(", ") || "unassigned", resolved.clock_in ?? "", resolved.clock_out ?? "", resolved.present ? "Present" : "Absent", resolved.evidence_state ? evidenceLabel(resolved.evidence_state) : ""]);
    }
    const blob = new Blob([lines.map((line) => line.map(csvCell).join(",")).join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `attendance_${range.dateFrom}_${range.dateTo}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (!isAdmin) return <section className="access-state"><ShieldAlert className="mx-auto" /><h1 className="mt-3 text-lg font-semibold">Administrator access required</h1></section>;

  return <div className="app-page">
    <PageHeader eyebrow="People operations" icon={<CalendarDays size={18} />} title="Team attendance" description="Server-authoritative presence with evidence tracked separately." actions={<Button size="sm" variant="outline" onClick={exportCSV} disabled={!report || loading} icon={<Download size={14} />}>Export CSV</Button>} />
    <div className="surface-toolbar">
      <div className="segmented-control" aria-label="Attendance period">{(["daily", "weekly", "monthly"] as const).map((item) => <button key={item} type="button" aria-pressed={period === item} onClick={() => setPeriod(item)} className="capitalize">{item}</button>)}</div>
      <div className="flex-1" />
      <Input type="date" value={selectedDate} max={getCurrentISTDate()} onChange={(event) => setSelectedDate(event.target.value)} containerClassName="w-full sm:w-[190px]" aria-label="Attendance date" />
    </div>
    <div className="metric-grid">
      <MetricCard label="Team members" value={report?.users.length ?? "—"} icon={<UserIcon size={17} />} tone="neutral" note="Active non-administrator accounts" />
      <MetricCard label={period === "daily" ? "Present" : "Attendance records"} value={report ? (period === "daily" ? presentCount : attendanceRecords) : "—"} icon={<CheckCircle2 size={17} />} tone="success" note={`${range.dateFrom} to ${range.dateTo}`} />
      <MetricCard label={period === "daily" ? "Absent" : "Highest attendance"} value={report ? (period === "daily" ? Math.max(0, report.users.length - presentCount) : Math.max(0, ...summaries.map((row) => row.daysPresent))) : "—"} icon={<AlertCircle size={17} />} tone={period === "daily" ? "danger" : "brand"} note={period === "daily" ? "No confirmed attendance row" : `Days present out of ${days.length}`} />
      <MetricCard label="Evidence expired" value={report ? report.attendance.filter((row) => row.selfie_purged_at || row.selfie_purge_state === "purged").length : "—"} icon={<CalendarDays size={17} />} tone="info" note="Presence remains unchanged" />
    </div>
    {error && <p role="alert" className="mb-4 text-sm text-[var(--status-danger)]">{error}</p>}
    <section className="data-table-shell" aria-labelledby="attendance-table-title">
      <div className="flex items-center justify-between gap-4 border-b border-[var(--border-subtle)] px-5 py-4"><div><p className="section-kicker">Attendance register</p><h2 id="attendance-table-title" className="mt-1 section-title">{period === "daily" ? "Daily status" : `${period[0].toUpperCase()}${period.slice(1)} attendance`}</h2></div><Chip variant="neutral" size="sm">{range.dateFrom === range.dateTo ? range.dateFrom : `${range.dateFrom} – ${range.dateTo}`}</Chip></div>
      {loading ? <div className="p-5">Loading authoritative attendance…</div> : !report ? <div className="p-5"><EmptyState icon={<AlertCircle size={21} />} title="Attendance unavailable" description="Statuses are hidden until the authoritative server responds." /></div> : report.users.length === 0 ? <div className="p-5"><EmptyState icon={<UserIcon size={21} />} title="No staff accounts" description="No active non-administrator users were returned." /></div> :
        <div className="overflow-x-auto"><table className="min-w-[760px]"><thead>{period === "daily" ? <tr><th>Staff member</th><th>Role</th><th>Status</th><th>Clock-in</th><th>Clock-out</th><th>Evidence</th></tr> : <tr><th>Staff member</th><th>Role</th><th>Days present</th><th>Attendance rate</th><th>Last seen</th></tr>}</thead><tbody>
          {period === "daily" ? dailyRows.map(({ user, resolved }) => <tr key={user.user_id}><td><p className="whitespace-normal break-words font-semibold">{user.name}</p></td><td className="whitespace-normal break-words capitalize">{user.capabilities.join(", ").replaceAll("_", " ") || "unassigned"}</td><td><Chip variant={resolved.present ? "success" : "danger"} size="sm" dot>{resolved.present ? "Present" : "Absent"}</Chip></td><td className="font-mono text-[12px]">{formatTime(resolved.clock_in)}</td><td className="font-mono text-[12px]">{formatTime(resolved.clock_out)}</td><td>{resolved.present ? <Chip variant={resolved.evidence_state === "available" ? "info" : "neutral"} size="sm">{evidenceLabel(resolved.evidence_state)}</Chip> : "—"}</td></tr>) : summaries.map(({ user, daysPresent, lastSeen }) => {
            const rate = Math.round((daysPresent / days.length) * 100);
            return <tr key={user.user_id}><td><p className="font-semibold">{user.name}</p></td><td className="capitalize">{user.capabilities.join(", ").replaceAll("_", " ") || "unassigned"}</td><td><span className="font-semibold tabular-nums">{daysPresent}</span> <span className="text-[11px] text-[var(--text-muted)]">/ {days.length}</span></td><td><div className="flex min-w-[150px] items-center gap-3"><div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--surface-tertiary)]"><div className={`h-full rounded-full ${rate >= 80 ? "bg-[var(--status-success)]" : rate >= 50 ? "bg-[var(--status-warning)]" : "bg-[var(--status-danger)]"}`} style={{ width: `${rate}%` }} /></div><span className="w-9 text-right text-[11px] font-semibold">{rate}%</span></div></td><td className="font-mono text-[12px]">{lastSeen ?? "Never"}</td></tr>;
          })}
        </tbody></table></div>}
    </section>
  </div>;
}
