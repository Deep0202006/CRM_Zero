"use client";

import React, { useState, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { db, LocalAttendance, LocalUser } from "@/lib/db";
import { CalendarDays, AlertCircle, ShieldAlert, Download, CheckCircle2, User as UserIcon } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Input } from "@/components/ui/Input";

export default function AdminAttendancePage() {
  const { isAdmin } = useAuth();
  
  const [attendance, setAttendance] = useState<LocalAttendance[]>([]);
  const [users, setUsers] = useState<LocalUser[]>([]);
  const [userRoles, setUserRoles] = useState<Record<string, string>>({});
  const [activeTab, setActiveTab] = useState<"daily" | "weekly" | "monthly">("daily");
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().slice(0, 10));

  const loadData = async () => {
    try {
      const att = await db.attendance.toArray();
      const usrs = await db.users.toArray();
      const caps = await db.user_capabilities.toArray();
      
      const rolesMap: Record<string, string> = {};
      caps.forEach((c) => {
        if (!rolesMap[c.user_id]) rolesMap[c.user_id] = c.capability_code;
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
      <Card className="max-w-md mx-auto mt-16 text-center space-y-4 p-8">
        <ShieldAlert size={40} className="mx-auto text-[var(--status-danger)]" />
        <h3 className="text-base font-black text-[var(--text-primary)]">Admin Access Required</h3>
        <p className="text-xs text-[var(--text-muted)] font-semibold">
          You do not have permission to view team attendance.
        </p>
      </Card>
    );
  }

  const exportCSV = () => {
    let csv = "Date,User ID,Name,Role,Clock In,Clock Out,Selfie URL\n";
    attendance.forEach((a) => {
      const u = users.find((usr) => usr.user_id === a.user_id);
      const role = userRoles[a.user_id] || "Unknown";
      csv += `"${a.date}","${a.user_id}","${u?.name || "Unknown"}","${role}","${a.clock_in || ""}","${a.clock_out || ""}","${a.selfie_url || ""}"\n`;
    });
    const blob = new Blob([csv], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `nexus_attendance_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    window.URL.revokeObjectURL(url);
  };

  const staffUsers = users.filter((u) => userRoles[u.user_id] !== "admin");

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
    <div className="space-y-6 w-full max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <CalendarDays size={20} className="text-[var(--brand-500)]" />
          <div>
            <h1 className="text-2xl font-black text-[var(--text-primary)]">Team Attendance</h1>
            <p className="text-xs text-[var(--text-muted)] font-bold uppercase tracking-wider">
              Monitor and export staff clock-ins
            </p>
          </div>
        </div>
        <Button size="sm" variant="outline" onClick={exportCSV} icon={<Download size={14} />}>
          Export CSV
        </Button>
      </div>

      {/* Tabs & Date Picker */}
      <Card className="p-3 flex flex-col sm:flex-row justify-between items-center gap-4">
        <div className="flex gap-1.5 p-1 bg-[var(--surface-secondary)] rounded-[var(--radius-md)] w-full sm:w-auto">
          {(["daily", "weekly", "monthly"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 sm:flex-none px-4 py-1.5 rounded-[var(--radius-sm)] text-xs font-bold capitalize transition-all cursor-pointer ${
                activeTab === tab
                  ? "bg-[var(--surface-primary)] text-[var(--brand-500)] shadow-xs"
                  : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {activeTab === "daily" && (
          <div className="w-full sm:w-auto">
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="px-3 py-1.5 bg-[var(--surface-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-sm)] text-xs font-bold text-[var(--text-primary)] focus:outline-none focus:border-[var(--brand-500)]"
            />
          </div>
        )}
      </Card>

      {/* Daily Summary */}
      {activeTab === "daily" && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="p-4 flex items-center justify-between">
            <div>
              <p className="text-[10px] font-black text-[var(--text-muted)] uppercase tracking-widest">Total Staff</p>
              <p className="text-2xl font-black text-[var(--text-primary)]">{staffUsers.length}</p>
            </div>
            <div className="h-10 w-10 bg-[var(--surface-secondary)] rounded-[var(--radius-md)] flex items-center justify-center">
              <UserIcon size={18} className="text-[var(--text-muted)]" />
            </div>
          </Card>
          <Card className="p-4 flex items-center justify-between border-[var(--status-success)]/20 bg-[var(--status-success-soft)]/40">
            <div>
              <p className="text-[10px] font-black text-[var(--status-success)] uppercase tracking-widest">Present</p>
              <p className="text-2xl font-black text-[var(--status-success)]">{presentCount}</p>
            </div>
            <div className="h-10 w-10 bg-[var(--status-success-soft)] rounded-[var(--radius-md)] flex items-center justify-center">
              <CheckCircle2 size={18} className="text-[var(--status-success)]" />
            </div>
          </Card>
          <Card className="p-4 flex items-center justify-between border-[var(--status-danger)]/20 bg-[var(--status-danger-soft)]/40">
            <div>
              <p className="text-[10px] font-black text-[var(--status-danger)] uppercase tracking-widest">Absent</p>
              <p className="text-2xl font-black text-[var(--status-danger)]">{absentCount}</p>
            </div>
            <div className="h-10 w-10 bg-[var(--status-danger-soft)] rounded-[var(--radius-md)] flex items-center justify-center">
              <AlertCircle size={18} className="text-[var(--status-danger)]" />
            </div>
          </Card>
        </div>
      )}

      {/* Content Table */}
      <Card className="overflow-hidden p-0 border border-[var(--border-subtle)]">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              {activeTab === "daily" ? (
                <tr className="bg-[var(--surface-secondary)] border-b border-[var(--border-subtle)] text-[10px] font-black text-[var(--text-muted)] uppercase tracking-widest">
                  <th className="p-4 pl-6">Staff Member</th>
                  <th className="p-4">Role</th>
                  <th className="p-4">Status</th>
                  <th className="p-4">Clock In Time</th>
                  <th className="p-4">Verification</th>
                </tr>
              ) : (
                <tr className="bg-[var(--surface-secondary)] border-b border-[var(--border-subtle)] text-[10px] font-black text-[var(--text-muted)] uppercase tracking-widest">
                  <th className="p-4 pl-6">Staff Member</th>
                  <th className="p-4">Role</th>
                  <th className="p-4">Days Present ({activeTab})</th>
                  <th className="p-4">Attendance Rate</th>
                  <th className="p-4">Last Seen</th>
                </tr>
              )}
            </thead>
            <tbody className="text-xs divide-y divide-[var(--border-subtle)]">
              {activeTab === "daily" ? (
                staffUsers.map((user) => {
                  const record = filteredRecords.find((a) => a.user_id === user.user_id);
                  const isPresent = !!record;
                  return (
                    <tr key={user.user_id} className="hover:bg-[var(--surface-hover)] transition-colors">
                      <td className="p-4 pl-6 font-bold text-[var(--text-primary)]">{user.name}</td>
                      <td className="p-4 font-semibold text-[var(--text-muted)] capitalize">
                        {(userRoles[user.user_id] || "unassigned").replace("_", " ")}
                      </td>
                      <td className="p-4">
                        <Chip variant={isPresent ? "success" : "danger"} size="sm">
                          {isPresent ? "Present" : "Absent"}
                        </Chip>
                      </td>
                      <td className="p-4 font-mono font-semibold text-[var(--text-secondary)]">
                        {record ? new Date(record.clock_in).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "--:--"}
                      </td>
                      <td className="p-4">
                        {record?.selfie_url ? (
                          <div className="h-8 w-8 rounded-full border border-[var(--border-subtle)] overflow-hidden">
                            <img src={record.selfie_url} alt="Selfie verification" className="h-full w-full object-cover" />
                          </div>
                        ) : record ? (
                          <Chip variant="neutral" size="sm">System</Chip>
                        ) : (
                          <span className="text-[var(--text-disabled)]">-</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              ) : (
                aggregatedData.map((agg) => {
                  const rate = Math.round((agg.daysPresent / maxDays) * 100);
                  return (
                    <tr key={agg.user.user_id} className="hover:bg-[var(--surface-hover)] transition-colors">
                      <td className="p-4 pl-6 font-bold text-[var(--text-primary)]">{agg.user.name}</td>
                      <td className="p-4 font-semibold text-[var(--text-muted)] capitalize">
                        {(userRoles[agg.user.user_id] || "unassigned").replace("_", " ")}
                      </td>
                      <td className="p-4 font-black text-[var(--text-primary)]">
                        {agg.daysPresent} <span className="text-[var(--text-muted)] text-[10px]">/ {maxDays}</span>
                      </td>
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-24 bg-[var(--surface-secondary)] rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${rate >= 80 ? "bg-[var(--status-success)]" : rate >= 50 ? "bg-[var(--status-warning)]" : "bg-[var(--status-danger)]"}`}
                              style={{ width: `${Math.min(rate, 100)}%` }}
                            />
                          </div>
                          <span className="font-bold text-[10px] text-[var(--text-muted)]">{rate}%</span>
                        </div>
                      </td>
                      <td className="p-4 font-mono font-semibold text-[var(--text-muted)]">
                        {agg.lastSeen !== "Never" ? new Date(agg.lastSeen).toLocaleDateString() : "Never"}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
