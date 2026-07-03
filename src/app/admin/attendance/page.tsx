"use client";

import React, { useState, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { db, LocalAttendance, LocalUser } from "@/lib/db";
import { CalendarDays, AlertCircle, ShieldAlert, Download, CheckCircle2, User as UserIcon } from "lucide-react";

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
      caps.forEach(c => {
        if (!rolesMap[c.user_id]) rolesMap[c.user_id] = c.capability_code;
      });

      setAttendance(att);
      setUsers(usrs);
      setUserRoles(rolesMap);
    } catch (err) {
      console.error("Failed to load attendance data", err);
    }
  };

  useEffect(() => { loadData(); }, []);

  if (!isAdmin) {
    return (
      <div className="max-w-md mx-auto mt-16 p-8 bg-white rounded-3xl border border-slate-100 shadow-sm text-center space-y-4">
        <ShieldAlert size={40} className="mx-auto text-rose-500" />
        <h3 className="text-lg font-black text-slate-900">Admin Only</h3>
        <p className="text-xs text-slate-500 font-semibold">You do not have permission to view team attendance.</p>
      </div>
    );
  }

  const exportCSV = () => {
    let csv = "Date,User ID,Name,Role,Clock In,Clock Out,Selfie URL\n";
    attendance.forEach(a => {
      const u = users.find(u => u.user_id === a.user_id);
      const role = userRoles[a.user_id] || 'Unknown';
      csv += `"${a.date}","${a.user_id}","${u?.name || 'Unknown'}","${role}","${a.clock_in || ''}","${a.clock_out || ''}","${a.selfie_url || ''}"\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nexus_attendance_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const staffUsers = users.filter(u => userRoles[u.user_id] !== "admin");

  // Filtering Logic
  const getFilteredRecords = () => {
    const today = new Date();
    if (activeTab === "daily") {
      return attendance.filter(a => a.date === selectedDate);
    } else if (activeTab === "weekly") {
      const sevenDaysAgo = new Date(today);
      sevenDaysAgo.setDate(today.getDate() - 7);
      return attendance.filter(a => new Date(a.date) >= sevenDaysAgo && new Date(a.date) <= today);
    } else {
      const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
      return attendance.filter(a => new Date(a.date) >= startOfMonth && new Date(a.date) <= today);
    }
  };

  const filteredRecords = getFilteredRecords();
  const presentCount = activeTab === "daily" ? filteredRecords.length : [...new Set(filteredRecords.map(r => r.user_id))].length;
  // Absent count makes sense mostly for daily. For weekly/monthly we show total active users.
  const absentCount = activeTab === "daily" ? staffUsers.length - presentCount : staffUsers.length - presentCount;

  // Aggregation for Weekly/Monthly view
  const getAggregation = () => {
    const agg: Record<string, { user: LocalUser, daysPresent: number, lastSeen: string }> = {};
    staffUsers.forEach(u => {
      agg[u.user_id] = { user: u, daysPresent: 0, lastSeen: "Never" };
    });
    filteredRecords.forEach(r => {
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
    <div className="space-y-6 w-full">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <CalendarDays size={20} className="text-brand-primary" />
          <div>
            <h2 className="text-2xl font-black text-slate-900">Team Attendance</h2>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Monitor and export staff clock-ins</p>
          </div>
        </div>
        <button onClick={exportCSV} className="flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-black rounded-xl text-xs transition-all cursor-pointer">
          <Download size={14} /> Export CSV
        </button>
      </div>

      {/* Tabs & Date Picker */}
      <div className="bg-white rounded-3xl border border-slate-100 p-2 shadow-sm flex flex-col sm:flex-row justify-between items-center gap-4">
        <div className="flex gap-1 w-full sm:w-auto p-1 bg-slate-50 rounded-2xl">
          {(["daily", "weekly", "monthly"] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 sm:flex-none px-6 py-2.5 rounded-xl text-xs font-black capitalize transition-all cursor-pointer ${
                activeTab === tab ? "bg-white text-brand-primary shadow-sm" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
        
        {activeTab === "daily" && (
          <div className="px-4">
            <input 
              type="date" 
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-xs font-bold text-slate-700 focus:outline-none focus:border-brand-primary"
            />
          </div>
        )}
      </div>

      {/* Daily Summary (only for Daily) */}
      {activeTab === "daily" && (
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-white rounded-2xl border border-slate-100 p-4 flex items-center justify-between">
            <div>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Total Staff</p>
              <p className="text-2xl font-black text-slate-900">{staffUsers.length}</p>
            </div>
            <div className="h-10 w-10 bg-slate-50 rounded-xl flex items-center justify-center"><UserIcon size={18} className="text-slate-400"/></div>
          </div>
          <div className="bg-emerald-50 rounded-2xl border border-emerald-100 p-4 flex items-center justify-between">
            <div>
              <p className="text-[10px] font-black text-emerald-600/70 uppercase tracking-widest">Present</p>
              <p className="text-2xl font-black text-emerald-600">{presentCount}</p>
            </div>
            <div className="h-10 w-10 bg-emerald-100/50 rounded-xl flex items-center justify-center"><CheckCircle2 size={18} className="text-emerald-600"/></div>
          </div>
          <div className="bg-rose-50 rounded-2xl border border-rose-100 p-4 flex items-center justify-between">
            <div>
              <p className="text-[10px] font-black text-rose-600/70 uppercase tracking-widest">Absent</p>
              <p className="text-2xl font-black text-rose-600">{absentCount}</p>
            </div>
            <div className="h-10 w-10 bg-rose-100/50 rounded-xl flex items-center justify-center"><AlertCircle size={18} className="text-rose-600"/></div>
          </div>
        </div>
      )}

      {/* Content Area */}
      <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            {activeTab === "daily" ? (
              <tr className="bg-slate-50 border-b border-slate-100 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                <th className="p-4 pl-6">Staff Member</th>
                <th className="p-4">Role</th>
                <th className="p-4">Status</th>
                <th className="p-4">Clock In Time</th>
                <th className="p-4">Verification</th>
              </tr>
            ) : (
              <tr className="bg-slate-50 border-b border-slate-100 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                <th className="p-4 pl-6">Staff Member</th>
                <th className="p-4">Role</th>
                <th className="p-4">Days Present ({activeTab})</th>
                <th className="p-4">Attendance Rate</th>
                <th className="p-4">Last Seen</th>
              </tr>
            )}
          </thead>
          <tbody className="text-xs divide-y divide-slate-50">
            {activeTab === "daily" ? (
              // DAILY VIEW
              staffUsers.map(user => {
                const record = filteredRecords.find(a => a.user_id === user.user_id);
                const isPresent = !!record;
                return (
                  <tr key={user.user_id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="p-4 pl-6 font-bold text-slate-900">{user.name}</td>
                    <td className="p-4 font-semibold text-slate-500 capitalize">{(userRoles[user.user_id] || "unassigned").replace("_", " ")}</td>
                    <td className="p-4">
                      <span className={`px-2 py-1 rounded-md text-[10px] font-black uppercase tracking-wider ${
                        isPresent ? "bg-emerald-50 text-emerald-600 border border-emerald-100" : "bg-rose-50 text-rose-600 border border-rose-100"
                      }`}>
                        {isPresent ? "Present" : "Absent"}
                      </span>
                    </td>
                    <td className="p-4 font-mono font-semibold text-slate-600">
                      {record ? new Date(record.clock_in).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'}) : "--:--"}
                    </td>
                    <td className="p-4">
                      {record?.selfie_url ? (
                        <div className="h-8 w-8 rounded-full border border-slate-200 overflow-hidden">
                          <img src={record.selfie_url} alt="Selfie" className="h-full w-full object-cover" />
                        </div>
                      ) : record ? (
                        <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-2 py-1 rounded">System</span>
                      ) : (
                        <span className="text-slate-300">-</span>
                      )}
                    </td>
                  </tr>
                );
              })
            ) : (
              // WEEKLY / MONTHLY VIEW
              aggregatedData.map(agg => {
                const rate = Math.round((agg.daysPresent / maxDays) * 100);
                return (
                  <tr key={agg.user.user_id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="p-4 pl-6 font-bold text-slate-900">{agg.user.name}</td>
                    <td className="p-4 font-semibold text-slate-500 capitalize">{(userRoles[agg.user.user_id] || "unassigned").replace("_", " ")}</td>
                    <td className="p-4 font-black text-slate-700">
                      {agg.daysPresent} <span className="text-slate-400 font-semibold text-[10px]">/ {maxDays}</span>
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-24 bg-slate-100 rounded-full overflow-hidden">
                          <div 
                            className={`h-full rounded-full ${rate >= 80 ? 'bg-emerald-500' : rate >= 50 ? 'bg-amber-500' : 'bg-rose-500'}`} 
                            style={{ width: `${Math.min(rate, 100)}%` }} 
                          />
                        </div>
                        <span className="font-bold text-[10px] text-slate-500">{rate}%</span>
                      </div>
                    </td>
                    <td className="p-4 font-mono font-semibold text-slate-600">
                      {agg.lastSeen !== "Never" ? new Date(agg.lastSeen).toLocaleDateString() : "Never"}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
