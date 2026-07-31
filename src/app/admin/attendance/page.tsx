"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { db, LocalAttendance, LocalUser } from "@/lib/db";
import { CalendarDays, AlertCircle, ShieldAlert, Download, CheckCircle2, User as UserIcon } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Input } from "@/components/ui/Input";
import { PageHeader } from "@/components/ui/PageHeader";
import { MetricCard } from "@/components/ui/MetricCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { getCurrentISTDate } from "@/lib/dateTime";

function attendanceStatus(record?: LocalAttendance) {
  if (!record) return "Absent";
  return record.clock_out ? "Logged out" : "Working";
}

function csvCell(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

export default function AdminAttendancePage() {
  const { isAdmin } = useAuth();
  
  const [attendance, setAttendance] = useState<LocalAttendance[]>([]);
  const [users, setUsers] = useState<LocalUser[]>([]);
  const [userRoles, setUserRoles] = useState<Record<string, string>>({});
  const [activeTab, setActiveTab] = useState<"daily" | "weekly" | "monthly">("daily");
  const [selectedDate, setSelectedDate] = useState<string>(getCurrentISTDate());

  const loadData = async () => {
    try {
      const att = await db.attendance.toArray();
      const usrs = await db.users.toArray();
      const caps = await db.user_capabilities.toArray();
      
      const rolesMap: Record<string, string> = {};
      caps.forEach((c) => {
        rolesMap[c.user_id] = [rolesMap[c.user_id], c.capability_code].filter(Boolean).join(", ");
      });

      setAttendance(att);
      setUsers(usrs);
      setUserRoles(rolesMap);
    } catch (err) {
      console.error("Failed to load attendance data", err);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  if (!isAdmin) {
    return (
      <section className="access-state" aria-labelledby="attendance-admin-access">
        <span className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-[var(--radius-lg)] bg-[var(--status-danger-soft)] text-[var(--status-danger)]"><ShieldAlert size={22} /></span>
        <h1 id="attendance-admin-access" className="text-lg font-semibold">Administrator access required</h1>
        <p className="mx-auto mt-2 max-w-sm text-[13px] leading-5 text-[var(--text-muted)]">Team attendance contains employee verification data and is restricted to administrators.</p>
      </section>
    );
  }

  const exportCSV = () => {
    let csv = "Date,User ID,Name,Role,Clock In,Clock Out,Status,Clock-in Selfie Recorded\n";
    attendance.forEach((a) => {
      const u = users.find((usr) => usr.user_id === a.user_id);
      const role = userRoles[a.user_id] || "Unknown";
      csv += [a.date, a.user_id, u?.name || "Unknown", role, a.clock_in || "", a.clock_out || "", attendanceStatus(a), a.selfie_url ? "Yes" : "No"].map(csvCell).join(",") + "\n";
    });
    const blob = new Blob([csv], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `nexus_attendance_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    window.URL.revokeObjectURL(url);
  };

  const staffUsers = users.filter((u) => !(userRoles[u.user_id] || "").split(", ").includes("admin"));

  const getFilteredRecords = () => {
    const today = new Date();
    if (activeTab === "daily") {
      return attendance.filter((a) => a.date === selectedDate);
    } else if (activeTab === "weekly") {
      const sevenDaysAgo = new Date(today);
      sevenDaysAgo.setDate(today.getDate() - 7);
      return attendance.filter((a) => new Date(a.date) >= sevenDaysAgo && new Date(a.date) <= today);
    } else {
      const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
      return attendance.filter((a) => new Date(a.date) >= startOfMonth && new Date(a.date) <= today);
    }
  };

  const filteredRecords = getFilteredRecords();
  const presentCount = activeTab === "daily" ? filteredRecords.length : [...new Set(filteredRecords.map((r) => r.user_id))].length;
  const absentCount = staffUsers.length - presentCount;

  const getAggregation = () => {
    const agg: Record<string, { user: LocalUser; daysPresent: number; lastSeen: string }> = {};
    staffUsers.forEach((u) => {
      agg[u.user_id] = { user: u, daysPresent: 0, lastSeen: "Never" };
    });
    filteredRecords.forEach((r) => {
      if (agg[r.user_id]) {
        agg[r.user_id].daysPresent += 1;
        if (agg[r.user_id].lastSeen === "Never" || new Date(r.date) > new Date(agg[r.user_id].lastSeen)) {
          agg[r.user_id].lastSeen = r.date;
        }
      }
    });
    return Object.values(agg).sort((a, b) => b.daysPresent - a.daysPresent);
  };

  const aggregatedData = getAggregation();
  const maxDays = activeTab === "weekly" ? 7 : new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();

  return (
    <div className="app-page">
      <PageHeader
        eyebrow="People operations"
        icon={<CalendarDays size={18} />}
        title="Team attendance"
        description="Review daily presence, compare attendance over time, and export verification-ready records."
        actions={<Button size="sm" variant="outline" onClick={exportCSV} icon={<Download size={14} />}>Export CSV</Button>}
      />

      <div className="surface-toolbar">
        <div className="segmented-control" aria-label="Attendance period">
          {(["daily", "weekly", "monthly"] as const).map((tab) => (
            <button key={tab} type="button" aria-pressed={activeTab === tab} onClick={() => setActiveTab(tab)} className="capitalize">{tab}</button>
          ))}
        </div>
        <div className="flex-1" />
        {activeTab === "daily" && (
          <Input type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} containerClassName="w-full sm:w-[190px]" aria-label="Attendance date" />
        )}
      </div>

      <div className="metric-grid">
        <MetricCard label="Team members" value={staffUsers.length} icon={<UserIcon size={17} />} tone="neutral" note="Active non-administrator accounts" />
        <MetricCard label={activeTab === "daily" ? "Present" : "Attendance records"} value={activeTab === "daily" ? presentCount : filteredRecords.length} icon={<CheckCircle2 size={17} />} tone="success" note={activeTab === "daily" ? `Clocked in on ${new Date(selectedDate).toLocaleDateString()}` : `Records in the ${activeTab} view`} />
        <MetricCard label={activeTab === "daily" ? "Absent" : "Highest attendance"} value={activeTab === "daily" ? absentCount : Math.max(0, ...aggregatedData.map((row) => row.daysPresent))} icon={<AlertCircle size={17} />} tone={activeTab === "daily" ? "danger" : "brand"} note={activeTab === "daily" ? "No record for the selected date" : `Days present in this ${activeTab} period`} />
        <MetricCard label="Verification records" value={filteredRecords.filter((record) => Boolean(record.selfie_url)).length} icon={<CalendarDays size={17} />} tone="info" note="Attendance entries containing a selfie" />
      </div>

      <section className="data-table-shell" aria-labelledby="attendance-table-title">
        <div className="flex items-center justify-between gap-4 border-b border-[var(--border-subtle)] px-5 py-4">
          <div><p className="section-kicker">Attendance register</p><h2 id="attendance-table-title" className="mt-1 section-title">{activeTab === "daily" ? "Daily status" : `${activeTab[0].toUpperCase()}${activeTab.slice(1)} attendance`}</h2></div>
          <Chip variant="neutral" size="sm">{activeTab === "daily" ? selectedDate : `${filteredRecords.length} records`}</Chip>
        </div>
        {staffUsers.length === 0 ? (
          <div className="p-5"><EmptyState icon={<UserIcon size={21} />} title="No staff accounts" description="Attendance appears after active non-administrator users are available." /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[760px]">
              <thead>
                {activeTab === "daily" ? (
                  <tr><th>Staff member</th><th>Role</th><th>Status</th><th>Clock-in</th><th>Clock-out</th><th>Clock-in verification</th></tr>
                ) : (
                  <tr><th>Staff member</th><th>Role</th><th>Days present</th><th>Attendance rate</th><th>Last seen</th></tr>
                )}
              </thead>
              <tbody>
                {activeTab === "daily" ? staffUsers.map((user) => {
                  const record = filteredRecords.find((attendanceRow) => attendanceRow.user_id === user.user_id);
                  return (
                    <tr key={user.user_id}>
                      <td><p className="min-w-0 whitespace-normal break-words font-semibold text-[var(--text-primary)]">{user.name}</p></td>
                      <td className="whitespace-normal break-words capitalize">{(userRoles[user.user_id] || "unassigned").replaceAll("_", " ")}</td>
                      <td><Chip variant={!record ? "danger" : record.clock_out ? "neutral" : "success"} size="sm" dot>{attendanceStatus(record)}</Chip></td>
                      <td className="font-mono text-[12px]">{record ? new Date(record.clock_in).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" }) : "—"}</td>
                      <td className="font-mono text-[12px]">{record?.clock_out ? new Date(record.clock_out).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" }) : "—"}</td>
                      <td>{record?.selfie_url ? <img src={record.selfie_url} alt={`Verification for ${user.name}`} className="h-9 w-9 rounded-[var(--radius-md)] object-cover ring-1 ring-[var(--border-default)]" /> : record ? <Chip variant="neutral" size="sm">System record</Chip> : <span className="text-[var(--text-disabled)]">—</span>}</td>
                    </tr>
                  );
                }) : aggregatedData.map((aggregate) => {
                  const rate = Math.round((aggregate.daysPresent / maxDays) * 100);
                  return (
                    <tr key={aggregate.user.user_id}>
                      <td><p className="font-semibold text-[var(--text-primary)]">{aggregate.user.name}</p></td>
                      <td className="capitalize">{(userRoles[aggregate.user.user_id] || "unassigned").replaceAll("_", " ")}</td>
                      <td><span className="font-semibold tabular-nums text-[var(--text-primary)]">{aggregate.daysPresent}</span> <span className="text-[11px] text-[var(--text-muted)]">/ {maxDays}</span></td>
                      <td><div className="flex min-w-[150px] items-center gap-3"><div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--surface-tertiary)]"><div className={`h-full rounded-full ${rate >= 80 ? "bg-[var(--status-success)]" : rate >= 50 ? "bg-[var(--status-warning)]" : "bg-[var(--status-danger)]"}`} style={{ width: `${Math.min(rate, 100)}%` }} /></div><span className="w-9 text-right text-[11px] font-semibold tabular-nums">{rate}%</span></div></td>
                      <td className="font-mono text-[12px]">{aggregate.lastSeen === "Never" ? "Never" : new Date(aggregate.lastSeen).toLocaleDateString()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
