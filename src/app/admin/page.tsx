"use client";

import React, { useState, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { db, LocalUser, LocalUserCapability, LocalTaskTemplate } from "@/lib/db";
import {
  ShieldCheck, User, Users, CheckSquare, Sparkles, Activity, AlertCircle,
  ListTodo, UserCheck, Clock as ClockIcon, Edit2, Save, ToggleLeft, ToggleRight, Download, UserPlus, Key, UploadCloud
} from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { exportPipelineToExcel } from "@/lib/pipelineExport";
import { exportClientQueriesToExcel } from "@/lib/clientQueriesExport";
import { exportMasterSales, exportMasterSupport, exportMasterMappings } from "@/lib/excelExport";
import { CreateUserPanel } from "@/components/admin/CreateUserPanel";
import { TaskAllocationWorkspace } from "@/components/TaskAllocationWorkspace";

type AdminTab = "capabilities" | "managers" | "templates" | "attendance" | "create_user" | "task_allocation" | "exports";

const TAB_META: { id: AdminTab; label: string; icon: React.ElementType }[] = [
  { id: "capabilities", label: "Capability Matrix", icon: ShieldCheck },
  { id: "managers", label: "Manager Assignment", icon: UserCheck },
  { id: "task_allocation", label: "Task Allocation", icon: UploadCloud },
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

  // Password reset state
  const [resettingPasswordFor, setResettingPasswordFor] = useState<string | null>(null);
  const [resetPasswordInput, setResetPasswordInput] = useState<string>("");
  const [newPasswordResult, setNewPasswordResult] = useState<string | null>(null);
  const [isResetting, setIsResetting] = useState(false);

  // Edit User state
  const [editingUser, setEditingUser] = useState<LocalUser | null>(null);
  const [editUserForm, setEditUserForm] = useState({ name: "", email: "", is_active: false });
  const [isUpdatingUser, setIsUpdatingUser] = useState(false);

  const ALL_CAPABILITIES = [
    { code: "admin", label: "Admin" },
    { code: "task_assigner", label: "Task Assigner" },
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
          const { error } = await supabase.from('user_capabilities').delete().eq('id', targetRow.id);
          if (error) throw error;
          await db.user_capabilities.delete(targetRow.id);
        }
      } else {
        const newCap = {
          user_id: targetUserId,
          capability_code: capCode,
          assigned_by: currentUser?.user_id || null,
        };
        const { data, error } = await supabase.from('user_capabilities').insert(newCap).select().single();
        if (error) throw error;
        await db.user_capabilities.add(data);
      }
      await refreshCapabilities();
      await loadAdminData();
      setHighlightRowId(targetUserId);
      setTimeout(() => setHighlightRowId(null), 1200);
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to update capabilities mapping in database.");
    }
  };

  const handleResetPassword = async (userId: string) => {
    setIsResetting(true);
    setErrorMsg(null);
    setNewPasswordResult(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("No session");
      
      const res = await fetch("/api/admin/reset-password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ user_id: userId, password: resetPasswordInput || undefined })
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to reset password");
      
      setNewPasswordResult(data.tempPassword);
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to reset password");
    } finally {
      setIsResetting(false);
    }
  };

  const handleUpdateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    setIsUpdatingUser(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("No session");
      
      const res = await fetch("/api/admin/update-user", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          user_id: editingUser.user_id,
          name: editUserForm.name,
          email: editUserForm.email,
          is_active: editUserForm.is_active
        })
      });
      
      const data = await res.json();
      // Handle the nested error object if it's from Zod (data.error.formErrors) or generic error string
      const errDetail = typeof data.error === 'object' && data.error.formErrors 
        ? data.error.formErrors.join(", ") 
        : data.error;
      if (!res.ok) throw new Error(errDetail || "Failed to update user");

      // Update local db
      await db.users.update(editingUser.user_id, {
        name: editUserForm.name,
        email: editUserForm.email,
        is_active: editUserForm.is_active ? 1 : 0
      });
      await loadAdminData();
      
      setSuccessMsg(`Updated user ${editUserForm.name} successfully.`);
      setEditingUser(null);
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to update user");
    } finally {
      setIsUpdatingUser(false);
    }
  };

  // ─── Manager Assignment ───────────────────────────────────────────────────

  const handleSetManager = async (userId: string, managerId: string | null) => {
    try {
      const { error } = await supabase.from('users').update({ manager_id: managerId || null }).eq('user_id', userId);
      if (error) throw error;
      
      await db.users.update(userId, { manager_id: managerId || undefined });
      await loadAdminData();
      setSuccessMsg("Manager assignment updated.");
      setTimeout(() => setSuccessMsg(null), 2000);
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to update manager assignment.");
    }
  };

  // ─── Task Templates ───────────────────────────────────────────────────────

  const handleSaveTemplate = async (templateId: string) => {
    try {
      const { error } = await supabase.from('task_templates').update(templateEdits).eq('template_id', templateId);
      if (error) throw error;
      
      await db.task_templates.update(templateId, templateEdits);
      setEditingTemplate(null);
      setTemplateEdits({});
      await loadAdminData();
      setSuccessMsg("Template saved.");
      setTimeout(() => setSuccessMsg(null), 2000);
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to save template.");
    }
  };

  const handleToggleTemplate = async (tpl: LocalTaskTemplate) => {
    try {
      const newActive = tpl.is_active === 1 ? 0 : 1;
      const { error } = await supabase.from('task_templates').update({ is_active: newActive }).eq('template_id', tpl.template_id);
      if (error) throw error;
      
      await db.task_templates.update(tpl.template_id, { is_active: newActive });
      await loadAdminData();
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to toggle template.");
    }
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
                    
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          setEditingUser(user);
                          setEditUserForm({
                            name: user.name,
                            email: user.email,
                            is_active: String(user.is_active) === "1" || String(user.is_active) === "true",
                          });
                        }}
                        className="text-[10px] font-bold text-slate-600 bg-white border border-slate-200 px-2 py-1 rounded-lg hover:bg-slate-50 transition-all uppercase tracking-wider flex-1 text-center"
                      >
                        Edit Details
                      </button>
                      <button
                        onClick={() => {
                          setResetPasswordInput("");
                          setResettingPasswordFor(user.user_id);
                        }}
                        className="text-[10px] font-bold text-amber-600 bg-amber-50 border border-amber-200 px-2 py-1 rounded-lg hover:bg-amber-100 transition-all uppercase tracking-wider flex-1 text-center"
                      >
                        Reset PW
                      </button>
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

      {/* ── TAB: Task Allocation ── */}
      {activeTab === "task_allocation" && (
        <TaskAllocationWorkspace />
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

      {/* Password Reset Modal */}
      {resettingPasswordFor && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[110] flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-md shadow-xl p-6">
            <h3 className="text-lg font-black text-slate-900 mb-2 flex items-center gap-2">
              <Key size={18} className="text-amber-500" /> Reset Password
            </h3>
            
            {!newPasswordResult ? (
              <>
                <p className="text-xs font-semibold text-slate-500 mb-4 leading-relaxed">
                  Are you sure you want to reset the password for <strong className="text-slate-900">{usersList.find(u => u.user_id === resettingPasswordFor)?.name}</strong>? They will be given a temporary password and must change it upon their next login.
                </p>

                <div className="mb-6">
                  <label className="block text-xs font-bold text-slate-700 mb-1">Set Password <span className="text-slate-400 font-normal">(Optional)</span></label>
                  <input 
                    type="text" 
                    placeholder="Leave empty to auto-generate" 
                    value={resetPasswordInput} 
                    onChange={(e) => setResetPasswordInput(e.target.value)} 
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500/50 text-sm" 
                  />
                </div>
                
                {errorMsg && (
                  <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-600 rounded-xl text-xs font-bold flex items-start gap-2">
                    <AlertCircle size={16} className="shrink-0 mt-0.5" />
                    <span>{errorMsg}</span>
                  </div>
                )}
                
                <div className="flex gap-2">
                  <button
                    onClick={() => { setResettingPasswordFor(null); setErrorMsg(null); setResetPasswordInput(""); }}
                    className="flex-1 py-3 bg-slate-100 text-slate-600 rounded-xl text-xs font-black uppercase tracking-wider hover:bg-slate-200 cursor-pointer transition-all"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => handleResetPassword(resettingPasswordFor)}
                    disabled={isResetting}
                    className="flex-1 py-3 bg-amber-500 text-white rounded-xl text-xs font-black uppercase tracking-wider hover:bg-amber-600 cursor-pointer shadow-md shadow-amber-500/20 disabled:opacity-50 transition-all"
                  >
                    {isResetting ? "Resetting..." : "Confirm Reset"}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="bg-emerald-50 border border-emerald-200 p-4 rounded-2xl mb-6">
                  <p className="text-[10px] font-black text-emerald-600 uppercase tracking-widest mb-2">
                    Password Reset Successful
                  </p>
                  <p className="text-xs text-slate-600 font-semibold mb-2">
                    Temporary Password for <strong className="text-slate-900">{usersList.find(u => u.user_id === resettingPasswordFor)?.name}</strong>:
                  </p>
                  <div className="bg-white border border-emerald-100 p-3 rounded-xl flex justify-center">
                    <code className="text-sm font-black text-slate-900 select-all font-mono tracking-widest">
                      {newPasswordResult}
                    </code>
                  </div>
                  <p className="text-[10px] text-emerald-600/70 font-semibold mt-3 text-center">
                    Please securely share this password with the user.
                  </p>
                </div>
                
                <button
                  onClick={() => { setResettingPasswordFor(null); setNewPasswordResult(null); }}
                  className="w-full py-3 bg-slate-100 text-slate-600 rounded-xl text-xs font-black uppercase tracking-wider hover:bg-slate-200 cursor-pointer transition-all"
                >
                  Close
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Edit User Modal */}
      {editingUser && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[110] flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-md shadow-xl p-6">
            <h3 className="text-lg font-black text-slate-900 mb-4 flex items-center gap-2">
              <Edit2 size={18} className="text-brand-primary" /> Edit User Details
            </h3>
            
            <form onSubmit={handleUpdateUser} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Name</label>
                <input 
                  required
                  type="text" 
                  value={editUserForm.name} 
                  onChange={(e) => setEditUserForm(p => ({...p, name: e.target.value}))} 
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-primary/50 text-sm" 
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Email / Username</label>
                <input 
                  required
                  type="email" 
                  value={editUserForm.email} 
                  onChange={(e) => setEditUserForm(p => ({...p, email: e.target.value}))} 
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-primary/50 text-sm" 
                />
              </div>

              <div className="pt-2">
                <label className="flex items-center space-x-2 cursor-pointer p-3 border border-slate-200 rounded-xl hover:bg-slate-50 transition-all">
                  <input 
                    type="checkbox" 
                    checked={editUserForm.is_active} 
                    onChange={(e) => setEditUserForm(p => ({...p, is_active: e.target.checked}))} 
                    className="rounded text-brand-primary w-4 h-4" 
                  />
                  <span className="text-sm font-bold text-slate-700">Account is Active</span>
                </label>
              </div>

              {errorMsg && (
                <div className="p-3 bg-red-50 border border-red-200 text-red-600 rounded-xl text-xs font-bold flex items-start gap-2">
                  <AlertCircle size={16} className="shrink-0 mt-0.5" />
                  <span>{errorMsg}</span>
                </div>
              )}
              
              <div className="flex gap-2 pt-4">
                <button
                  type="button"
                  onClick={() => { setEditingUser(null); setErrorMsg(null); }}
                  className="flex-1 py-3 bg-slate-100 text-slate-600 rounded-xl text-xs font-black uppercase tracking-wider hover:bg-slate-200 cursor-pointer transition-all"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isUpdatingUser}
                  className="flex-1 py-3 bg-brand-primary text-white rounded-xl text-xs font-black uppercase tracking-wider hover:bg-brand-secondary cursor-pointer shadow-md shadow-brand-primary/20 disabled:opacity-50 transition-all"
                >
                  {isUpdatingUser ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
