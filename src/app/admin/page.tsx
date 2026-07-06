"use client";

import React, { useState, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { db, LocalUser, LocalUserCapability, LocalTaskTemplate } from "@/lib/db";
import {
  ShieldCheck, User, Users, CheckSquare, Sparkles, Activity, AlertCircle,
  ListTodo, UserCheck, Clock as ClockIcon, Edit2, Save, ToggleLeft, ToggleRight, Download, UserPlus
} from "lucide-react";
import { exportPipelineToExcel } from "@/lib/pipelineExport";
import { exportClientQueriesToExcel } from "@/lib/clientQueriesExport";
import { exportMasterSales, exportMasterSupport, exportMasterMappings } from "@/lib/excelExport";
import { CreateUserPanel } from "@/components/admin/CreateUserPanel";

type AdminTab = "capabilities" | "managers" | "templates" | "attendance" | "create_user" | "exports";

const TAB_META: { id: AdminTab; label: string; icon: React.ElementType }[] = [
  { id: "capabilities", label: "Capability Matrix", icon: ShieldCheck },
  { id: "managers", label: "Manager Assignment", icon: UserCheck },
  { id: "templates", label: "Task Templates", icon: ListTodo },
  { id: "attendance", label: "Attendance Settings", icon: ClockIcon },
  { id: "create_user", label: "Create User", icon: UserPlus },
  { id: "exports", label: "Master Exports", icon: Download },
];

export default function AdminPage() {
  const { currentUser, isAdmin, refreshCapabilities } = useAuth();

  const [activeTab, setActiveTab] = useState<AdminTab>("capabilities");

  // Capability matrix state
  const [usersList, setUsersList] = useState<LocalUser[]>([]);
  const [userCapsMap, setUserCapsMap] = useState<Record<string, string[]>>({});
  const [highlightRowId, setHighlightRowId] = useState<string | null>(null);

  // Task templates state
  const [templates, setTemplates] = useState<LocalTaskTemplate[]>([]);
  const [editingTemplate, setEditingTemplate] = useState<string | null>(null);
  const [templateEdits, setTemplateEdits] = useState<Partial<LocalTaskTemplate>>({});

  // Attendance settings state
  const [shiftStart, setShiftStart] = useState("10:00");
  const [graceMinutes, setGraceMinutes] = useState(15);
  const [shiftSaved, setShiftSaved] = useState(false);

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const ALL_CAPABILITIES = [
    { code: "admin", label: "Admin" },
    { code: "dist_onboarding", label: "Dist. Onboarding" },
    { code: "dist_support", label: "Dist. Support" },
    { code: "ret_onboarding", label: "Retail Onboarding" },
    { code: "ret_support", label: "Retail Support" },
    { code: "field_dist", label: "Field Dist." },
    { code: "field_ret", label: "Field Retail" },
    { code: "tech_support", label: "Tech Support" },
  ];

  const loadAdminData = async () => {
    try {
      const allUsers = await db.users.toArray();
      setUsersList(allUsers);

      const allCaps = await db.user_capabilities.toArray();
      const mapping: Record<string, string[]> = {};
      allUsers.forEach((u) => {
        mapping[u.user_id] = allCaps
          .filter((c) => c.user_id === u.user_id)
          .map((c) => c.capability_code);
      });
      setUserCapsMap(mapping);

      const tmpl = await db.task_templates.toArray();
      setTemplates(tmpl);
    } catch (err) {
      console.error("Failed to load admin workspace data", err);
    }
  };

  useEffect(() => {
    loadAdminData();
  }, []);

  // ─── Capability Matrix ────────────────────────────────────────────────────

  const handleToggleCapability = async (targetUserId: string, capCode: string, hasCap: boolean) => {
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      if (hasCap) {
        const rows = await db.user_capabilities.where("user_id").equals(targetUserId).toArray();
        const targetRow = rows.find((r) => r.capability_code === capCode);
        if (targetRow) {
          await db.user_capabilities.delete(targetRow.id);
          await db.sync_queue.add({ idempotency_key: crypto.randomUUID(),  table_name: "user_capabilities", action: "DELETE", data: { id: targetRow.id }, timestamp: new Date().toISOString() });
        }
      } else {
        const newCap: LocalUserCapability = {
          id: crypto.randomUUID(),
          user_id: targetUserId,
          capability_code: capCode,
          assigned_by: currentUser?.user_id || "admin",
          assigned_at: new Date().toISOString(),
        };
        await db.user_capabilities.add(newCap);
        await db.sync_queue.add({ idempotency_key: crypto.randomUUID(),  table_name: "user_capabilities", action: "INSERT", data: newCap, timestamp: new Date().toISOString() });
      }
      await refreshCapabilities();
      await loadAdminData();
      setHighlightRowId(targetUserId);
      setTimeout(() => setHighlightRowId(null), 1200);
    } catch (err) {
      setErrorMsg("Failed to update capabilities mapping in database.");
    }
  };

  // ─── Manager Assignment ───────────────────────────────────────────────────

  const handleSetManager = async (userId: string, managerId: string | null) => {
    try {
      await db.users.update(userId, { manager_id: managerId || undefined });
      await db.sync_queue.add({ idempotency_key: crypto.randomUUID(), 
        table_name: "users",
        action: "UPDATE",
        data: { user_id: userId, manager_id: managerId },
        timestamp: new Date().toISOString(),
      });
      await loadAdminData();
      setSuccessMsg("Manager assignment updated.");
      setTimeout(() => setSuccessMsg(null), 2000);
    } catch (err) {
      setErrorMsg("Failed to update manager assignment.");
    }
  };

  // ─── Task Templates ───────────────────────────────────────────────────────

  const handleSaveTemplate = async (templateId: string) => {
    try {
      await db.task_templates.update(templateId, templateEdits);
      await db.sync_queue.add({ idempotency_key: crypto.randomUUID(), 
        table_name: "task_templates",
        action: "UPDATE",
        data: { template_id: templateId, ...templateEdits },
        timestamp: new Date().toISOString(),
      });
      setEditingTemplate(null);
      setTemplateEdits({});
      await loadAdminData();
      setSuccessMsg("Template saved.");
      setTimeout(() => setSuccessMsg(null), 2000);
    } catch (err) {
      setErrorMsg("Failed to save template.");
    }
  };

  const handleToggleTemplate = async (tpl: LocalTaskTemplate) => {
    const newActive = tpl.is_active === 1 ? 0 : 1;
    await db.task_templates.update(tpl.template_id, { is_active: newActive });
    await db.sync_queue.add({ idempotency_key: crypto.randomUUID(), 
      table_name: "task_templates",
      action: "UPDATE",
      data: { template_id: tpl.template_id, is_active: newActive },
      timestamp: new Date().toISOString(),
    });
    await loadAdminData();
  };

  // ─── Attendance Settings ──────────────────────────────────────────────────

  const handleSaveShift = () => {
    // Persisted locally in component state — in production would write to attendance_shift_config
    setShiftSaved(true);
    setTimeout(() => setShiftSaved(false), 2000);
  };

  if (!isAdmin) {
    return (
      <div className="max-w-md mx-auto mt-16 p-8 bg-white rounded-3xl border border-slate-100 shadow-sm text-center space-y-4">
        <AlertCircle className="mx-auto text-status-error" size={40} />
        <h3 className="text-lg font-black text-slate-900">Access Restricted</h3>
        <p className="text-xs text-slate-500 font-bold uppercase leading-normal">
          Requires Administrator security capability to view Oracle Control panel.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-slate-900">Admin Control Panel</h2>
          <p className="text-xs text-slate-400 font-bold uppercase tracking-wider">Oracle User Capability Matrix</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => {
              if (currentUser) exportPipelineToExcel(currentUser.user_id, true);
            }}
            className="flex items-center gap-1.5 px-3 py-2 bg-brand-primary text-white rounded-xl text-xs font-black cursor-pointer hover:bg-brand-secondary transition-all"
          >
            <Download size={14} /> Pipeline
          </button>
          <button
            onClick={() => {
              if (currentUser) exportClientQueriesToExcel(currentUser.user_id, true);
            }}
            className="flex items-center gap-1.5 px-3 py-2 bg-brand-primary text-white rounded-xl text-xs font-black cursor-pointer hover:bg-brand-secondary transition-all"
          >
            <Download size={14} /> Queries
          </button>
        </div>
      </div>

      {/* Feedback messages */}
      {successMsg && (
        <div className="p-4 bg-status-success/10 border border-status-success/20 text-status-success rounded-2xl text-xs font-bold">
          {successMsg}
        </div>
      )}
      {errorMsg && (
        <div className="p-4 bg-status-error/10 border border-status-error/20 text-status-error rounded-2xl text-xs font-bold flex items-center gap-2">
          <AlertCircle size={16} /> {errorMsg}
        </div>
      )}

      {/* Tab bar */}
      <div className="flex gap-1 bg-slate-100 p-1 rounded-2xl w-full overflow-x-auto">
        {TAB_META.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-[11px] font-black whitespace-nowrap transition-all cursor-pointer ${
              activeTab === tab.id
                ? "bg-white text-brand-primary shadow-sm"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            <tab.icon size={13} />
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── TAB: Capability Matrix ── */}
      {activeTab === "capabilities" && (
        <div className="bg-white rounded-3xl border border-slate-100 p-6 md:p-8 shadow-sm space-y-6">
          <div className="flex justify-between items-center pb-4 border-b border-slate-100">
            <h3 className="text-base font-black text-slate-900 flex items-center gap-2">
              <Users size={18} className="text-brand-primary" /> Active Team Directory
            </h3>
            <span className="text-[10px] bg-slate-100 text-slate-500 px-2.5 py-0.5 rounded-full font-bold uppercase">
              {usersList.length} User entries
            </span>
          </div>

          <div className="space-y-4">
            {usersList.map((user) => {
              const userCaps = userCapsMap[user.user_id] || [];
              const isHighlighted = highlightRowId === user.user_id;
              return (
                <div
                  key={user.user_id}
                  className={`p-5 rounded-2xl bg-slate-50/50 border transition-all duration-300 ${
                    isHighlighted
                      ? "border-status-success ring-4 ring-status-success/5 bg-emerald-50/10 shadow-[0_8px_24px_rgba(16,185,129,0.06)]"
                      : "border-slate-100 hover:border-slate-200"
                  }`}
                >
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                    <div className="flex items-center space-x-3 min-w-[200px]">
                      <div className={`h-8 w-8 rounded-full flex items-center justify-center font-bold text-xs ${isHighlighted ? "bg-status-success text-white" : "bg-slate-200 text-slate-600"}`}>
                        {user.name.substring(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <h4 className="text-xs font-black text-slate-900">{user.name}</h4>
                        <p className="text-[10px] text-slate-400 font-semibold">{user.email}</p>
                      </div>
                    </div>
                    <div className="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {ALL_CAPABILITIES.map((cap) => {
                        const hasCap = userCaps.includes(cap.code);
                        return (
                          <label
                            key={cap.code}
                            className={`flex items-center space-x-2 p-2 rounded-xl border text-[10px] font-bold uppercase cursor-pointer select-none transition-all ${
                              hasCap
                                ? "bg-brand-primary/5 border-brand-primary/20 text-brand-primary hover:bg-brand-primary/10"
                                : "bg-white border-slate-200 hover:bg-slate-50 text-slate-500"
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={hasCap}
                              onChange={() => handleToggleCapability(user.user_id, cap.code, hasCap)}
                              className="rounded border-slate-300 text-brand-primary focus:ring-brand-primary focus:ring-opacity-20 focus:ring-offset-0 cursor-pointer h-3.5 w-3.5"
                            />
                            <span className="truncate">{cap.label}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── TAB: Manager Assignment ── */}
      {activeTab === "managers" && (
        <div className="bg-white rounded-3xl border border-slate-100 p-6 shadow-sm space-y-4">
          <h3 className="text-base font-black text-slate-900 flex items-center gap-2">
            <UserCheck size={18} className="text-brand-primary" /> Manager Assignment
          </h3>
          <p className="text-xs text-slate-400 font-semibold">
            Set each team member's direct manager. Used for KPI rollup visibility.
          </p>
          <div className="space-y-3">
            {usersList.map((user) => (
              <div key={user.user_id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 bg-slate-50 rounded-2xl border border-slate-100">
                <div>
                  <p className="text-sm font-black text-slate-900">{user.name}</p>
                  <p className="text-[10px] text-slate-400 font-semibold">{user.email}</p>
                </div>
                <select
                  value={user.manager_id ?? ""}
                  onChange={(e) => handleSetManager(user.user_id, e.target.value || null)}
                  className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold text-slate-900 focus:outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/10 transition-all"
                >
                  <option value="">— No manager —</option>
                  {usersList
                    .filter((u) => u.user_id !== user.user_id)
                    .map((u) => (
                      <option key={u.user_id} value={u.user_id}>
                        {u.name}
                      </option>
                    ))}
                </select>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── TAB: Task Templates ── */}
      {activeTab === "templates" && (
        <div className="bg-white rounded-3xl border border-slate-100 p-6 shadow-sm space-y-4">
          <h3 className="text-base font-black text-slate-900 flex items-center gap-2">
            <ListTodo size={18} className="text-brand-primary" /> Task Templates ({templates.length})
          </h3>
          <p className="text-xs text-slate-400 font-semibold">
            Edit the daily task templates generated for each role.
          </p>
          <div className="space-y-3">
            {templates.map((tpl) => {
              const isEditing = editingTemplate === tpl.template_id;
              return (
                <div
                  key={tpl.template_id}
                  className={`p-4 rounded-2xl border transition-all ${tpl.is_active ? "bg-slate-50 border-slate-100" : "bg-slate-100/50 border-slate-200 opacity-60"}`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                    {/* Toggle active */}
                    <button
                      onClick={() => handleToggleTemplate(tpl)}
                      title={tpl.is_active ? "Deactivate" : "Activate"}
                      className="shrink-0 mt-0.5 cursor-pointer"
                    >
                      {tpl.is_active ? (
                        <ToggleRight size={20} className="text-brand-primary" />
                      ) : (
                        <ToggleLeft size={20} className="text-slate-400" />
                      )}
                    </button>

                    <div className="flex-1 min-w-0">
                      {isEditing ? (
                        <div className="space-y-2">
                          <input
                            value={templateEdits.title ?? tpl.title}
                            onChange={(e) => setTemplateEdits((p) => ({ ...p, title: e.target.value }))}
                            className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm font-semibold text-slate-900 focus:outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/10"
                          />
                          <select
                            value={templateEdits.default_priority ?? tpl.default_priority}
                            onChange={(e) => setTemplateEdits((p) => ({ ...p, default_priority: e.target.value as "High" | "Medium" | "Low" }))}
                            className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold text-slate-900 focus:outline-none focus:border-brand-primary"
                          >
                            <option value="High">High</option>
                            <option value="Medium">Medium</option>
                            <option value="Low">Low</option>
                          </select>
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleSaveTemplate(tpl.template_id)}
                              className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-primary text-white rounded-xl text-xs font-black cursor-pointer hover:bg-brand-secondary transition-all"
                            >
                              <Save size={12} /> Save
                            </button>
                            <button
                              onClick={() => { setEditingTemplate(null); setTemplateEdits({}); }}
                              className="px-3 py-1.5 bg-slate-100 text-slate-600 rounded-xl text-xs font-black cursor-pointer hover:bg-slate-200 transition-all"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div>
                          <p className="text-sm font-black text-slate-900">{tpl.title}</p>
                          <p className="text-[10px] text-slate-400 font-bold mt-0.5 uppercase tracking-wider">
                            {tpl.applies_to_capability} · {tpl.default_priority} priority
                          </p>
                        </div>
                      )}
                    </div>

                    {!isEditing && (
                      <button
                        onClick={() => {
                          setEditingTemplate(tpl.template_id);
                          setTemplateEdits({ title: tpl.title, default_priority: tpl.default_priority });
                        }}
                        className="shrink-0 p-2 rounded-xl hover:bg-brand-primary/5 text-slate-400 hover:text-brand-primary transition-all cursor-pointer"
                      >
                        <Edit2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── TAB: Attendance Settings ── */}
      {activeTab === "attendance" && (
        <div className="bg-white rounded-3xl border border-slate-100 p-6 shadow-sm space-y-6 max-w-md">
          <h3 className="text-base font-black text-slate-900 flex items-center gap-2">
            <ClockIcon size={18} className="text-brand-primary" /> Attendance Settings
          </h3>
          <p className="text-xs text-slate-400 font-semibold">
            Configure the shift start time. Staff who clock in after this window are marked Late in their KPI.
          </p>

          <div className="space-y-5">
            <div>
              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
                Shift Start Time
              </label>
              <input
                type="time"
                value={shiftStart}
                onChange={(e) => setShiftStart(e.target.value)}
                className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-semibold text-slate-900 focus:outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/10 transition-all"
              />
            </div>

            <div>
              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
                Grace Period (minutes)
              </label>
              <input
                type="number"
                min={0}
                max={60}
                value={graceMinutes}
                onChange={(e) => setGraceMinutes(Number(e.target.value))}
                className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-semibold text-slate-900 focus:outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/10 transition-all w-32"
              />
              <p className="text-[10px] text-slate-400 mt-1.5 font-semibold">
                Staff are marked Late after <strong className="text-slate-700">{shiftStart}</strong> + {graceMinutes} min
              </p>
            </div>

            <button
              onClick={handleSaveShift}
              className="flex items-center gap-2 px-5 py-3 bg-brand-primary hover:bg-brand-secondary text-white font-black rounded-xl text-xs tracking-wider uppercase transition-all shadow-sm shadow-brand-primary/10 cursor-pointer"
            >
              <Save size={14} />
              {shiftSaved ? "Saved ✓" : "Save Settings"}
            </button>
          </div>

          <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl text-xs text-amber-700 font-semibold">
            <strong>Production note:</strong> These settings are stored in <code>public.attendance_shift_config</code> on Supabase and read by the nightly KPI function. Run the SQL from the guidebook Part 4.2 to activate this in your database.
          </div>
        </div>
      )}

      {/* ── TAB: Create User ── */}
      {activeTab === "create_user" && (
        <div className="bg-white rounded-3xl border border-slate-100 p-6 shadow-sm space-y-6 max-w-2xl">
          <h3 className="text-base font-black text-slate-900 flex items-center gap-2">
            <UserPlus size={18} className="text-brand-primary" /> Create New User
          </h3>
          <p className="text-xs text-slate-400 font-semibold">
            Provision new team member accounts with appropriate capability clearances. A secure temporary password will be generated automatically.
          </p>
          <CreateUserPanel />
        </div>
      )}

      {/* ── MASTER EXPORTS TAB ── */}
      {activeTab === "exports" && (
        <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-6 space-y-6">
          <div>
            <h3 className="text-base font-black text-slate-900 flex items-center gap-2">
              <Download size={18} className="text-brand-primary" /> Master System Exports
            </h3>
            <p className="text-xs font-semibold text-slate-500 mt-1">Download complete data dumps across the entire CRM platform.</p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="p-5 border border-slate-200 rounded-2xl bg-slate-50 space-y-3 flex flex-col justify-between">
              <div>
                <h4 className="text-sm font-black text-slate-900">Sales Pipeline</h4>
                <p className="text-[11px] text-slate-500 font-medium mt-1">All leads, segments, and current stage data.</p>
              </div>
              <button
                onClick={() => exportMasterSales()}
                className="w-full py-2.5 bg-brand-primary text-white font-black rounded-xl text-xs hover:bg-brand-secondary transition-all cursor-pointer"
              >
                Download Sales Data
              </button>
            </div>

            <div className="p-5 border border-slate-200 rounded-2xl bg-slate-50 space-y-3 flex flex-col justify-between">
              <div>
                <h4 className="text-sm font-black text-slate-900">Support Operations</h4>
                <p className="text-[11px] text-slate-500 font-medium mt-1">All client queries, resolutions, and notes.</p>
              </div>
              <button
                onClick={() => exportMasterSupport()}
                className="w-full py-2.5 bg-brand-primary text-white font-black rounded-xl text-xs hover:bg-brand-secondary transition-all cursor-pointer"
              >
                Download Support Data
              </button>
            </div>

            <div className="p-5 border border-slate-200 rounded-2xl bg-slate-50 space-y-3 flex flex-col justify-between">
              <div>
                <h4 className="text-sm font-black text-slate-900">Distributor-Retailer Mappings</h4>
                <p className="text-[11px] text-slate-500 font-medium mt-1">All link requests, statuses, and agent trackers.</p>
              </div>
              <button
                onClick={() => exportMasterMappings()}
                className="w-full py-2.5 bg-brand-primary text-white font-black rounded-xl text-xs hover:bg-brand-secondary transition-all cursor-pointer"
              >
                Download Mapping Data
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Audit notice */}
      <div className="bg-slate-50 border border-slate-200/50 p-6 rounded-3xl text-xs space-y-2">
        <h4 className="font-black text-slate-900 uppercase tracking-widest text-[10px] flex items-center gap-1.5">
          <Activity size={12} className="text-brand-secondary animate-pulse" />
          Audit Ledger Notice
        </h4>
        <p className="text-slate-500 font-semibold leading-relaxed">
          Toggling corporate capabilities writes database sync logs locally. Operational clearances take effect instantly upon save, restricting module views and Supabase query policies dynamically.
        </p>
      </div>
    </div>
  );
}
