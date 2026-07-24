"use client";

import React, { useState, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { db, LocalUser, LocalTaskTemplate } from "@/lib/db";
import {
  ShieldCheck, Users, AlertCircle,
  ListTodo, UserCheck, Clock as ClockIcon, Edit2, Save, ToggleLeft, ToggleRight, Download, UserPlus, Key, UploadCloud, CheckCircle2
} from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { exportPipelineToExcel } from "@/lib/pipelineExport";
import { exportClientQueriesToExcel } from "@/lib/clientQueriesExport";
import { exportMasterSales, exportMasterSupport, exportMasterMappings } from "@/lib/excelExport";
import { CreateUserPanel } from "@/components/admin/CreateUserPanel";
import { TaskAllocationWorkspace } from "@/components/TaskAllocationWorkspace";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Chip } from "@/components/ui/Chip";
import { PageHeader } from "@/components/ui/PageHeader";
import { MetricCard } from "@/components/ui/MetricCard";
import { Modal } from "@/components/ui/Modal";
import { EmptyState } from "@/components/ui/EmptyState";

type AdminTab = "capabilities" | "managers" | "templates" | "attendance" | "create_user" | "task_allocation" | "exports";

const TAB_META: { id: AdminTab; label: string; icon: React.ComponentType<{ size?: number }> }[] = [
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

  const [usersList, setUsersList] = useState<LocalUser[]>([]);
  const [userCapsMap, setUserCapsMap] = useState<Record<string, string[]>>({});
  const [highlightRowId, setHighlightRowId] = useState<string | null>(null);

  const [templates, setTemplates] = useState<LocalTaskTemplate[]>([]);
  const [editingTemplate, setEditingTemplate] = useState<string | null>(null);
  const [templateEdits, setTemplateEdits] = useState<Partial<LocalTaskTemplate>>({});

  const [shiftStart, setShiftStart] = useState("10:00");
  const [graceMinutes, setGraceMinutes] = useState(15);
  const [shiftSaved, setShiftSaved] = useState(false);

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [resettingPasswordFor, setResettingPasswordFor] = useState<string | null>(null);
  const [resetPasswordInput, setResetPasswordInput] = useState<string>("");
  const [newPasswordResult, setNewPasswordResult] = useState<string | null>(null);
  const [isResetting, setIsResetting] = useState(false);

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
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to update capabilities mapping in database.");
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
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to reset password");
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
      const errDetail = typeof data.error === 'object' && data.error.formErrors 
        ? data.error.formErrors.join(", ") 
        : data.error;
      if (!res.ok) throw new Error(errDetail || "Failed to update user");

      await db.users.update(editingUser.user_id, {
        name: editUserForm.name,
        email: editUserForm.email,
        is_active: editUserForm.is_active ? 1 : 0
      });
      await loadAdminData();
      
      setSuccessMsg(`Updated user ${editUserForm.name} successfully.`);
      setEditingUser(null);
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to update user");
    } finally {
      setIsUpdatingUser(false);
    }
  };

  const handleSetManager = async (userId: string, managerId: string | null) => {
    try {
      const { error } = await supabase.from('users').update({ manager_id: managerId || null }).eq('user_id', userId);
      if (error) throw error;
      
      await db.users.update(userId, { manager_id: managerId || undefined });
      await loadAdminData();
      setSuccessMsg("Manager assignment updated.");
      setTimeout(() => setSuccessMsg(null), 2000);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to update manager assignment.");
    }
  };

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
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to save template.");
    }
  };

  const handleToggleTemplate = async (tpl: LocalTaskTemplate) => {
    try {
      const newActive = tpl.is_active === 1 ? 0 : 1;
      const { error } = await supabase.from('task_templates').update({ is_active: newActive }).eq('template_id', tpl.template_id);
      if (error) throw error;
      
      await db.task_templates.update(tpl.template_id, { is_active: newActive });
      await loadAdminData();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to toggle template.");
    }
  };

  const handleSaveShift = () => {
    setShiftSaved(true);
    setTimeout(() => setShiftSaved(false), 2000);
  };

  if (!isAdmin) {
    return (
      <section className="access-state" aria-labelledby="admin-access-title">
        <span className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-[var(--radius-lg)] bg-[var(--status-danger-soft)] text-[var(--status-danger)]"><AlertCircle size={22} /></span>
        <h1 id="admin-access-title" className="text-lg font-semibold">Administrator access required</h1>
        <p className="mx-auto mt-2 max-w-sm text-[13px] leading-5 text-[var(--text-muted)]">User capabilities, credentials, system exports, and configuration are restricted administrative operations.</p>
      </section>
    );
  }

  const activeUsers = usersList.filter((user) => String(user.is_active) === "1" || String(user.is_active) === "true").length;
  const assignedManagers = usersList.filter((user) => Boolean(user.manager_id)).length;
  const activeTemplates = templates.filter((template) => template.is_active === 1).length;
  const currentTab = TAB_META.find((tab) => tab.id === activeTab);

  return (
    <div className="app-page">
      <PageHeader
        eyebrow="System administration"
        icon={<ShieldCheck size={18} />}
        title="Admin control centre"
        description="Manage people, access, task automation, attendance configuration, and governed data exports from one consistent workspace."
        actions={
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => currentUser && exportPipelineToExcel(currentUser.user_id, true)} icon={<Download size={14} />}>Pipeline</Button>
            <Button size="sm" variant="outline" onClick={() => currentUser && exportClientQueriesToExcel(currentUser.user_id, true)} icon={<Download size={14} />}>Queries</Button>
          </div>
        }
      />

      <div className="metric-grid">
        <MetricCard label="Active accounts" value={activeUsers} icon={<Users size={17} />} tone="brand" note={`${usersList.length} total user records`} />
        <MetricCard label="Manager links" value={assignedManagers} icon={<UserCheck size={17} />} tone="info" note="People assigned to a reporting manager" />
        <MetricCard label="Active templates" value={activeTemplates} icon={<ListTodo size={17} />} tone="success" note={`${templates.length} templates configured`} />
        <MetricCard label="Capabilities" value={ALL_CAPABILITIES.length} icon={<ShieldCheck size={17} />} tone="neutral" note="Permission codes available for assignment" />
      </div>

      {successMsg && <div className="alert-panel alert-panel--success" role="status"><CheckCircle2 size={16} className="mt-0.5 shrink-0" /><span>{successMsg}</span></div>}
      {errorMsg && <div className="alert-panel alert-panel--danger" role="alert"><AlertCircle size={16} className="mt-0.5 shrink-0" /><span>{errorMsg}</span></div>}

      <div className="grid items-start gap-5 lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="surface-panel overflow-hidden lg:sticky lg:top-4" aria-label="Administration sections">
          <div className="border-b border-[var(--border-subtle)] bg-[var(--surface-secondary)] p-4"><p className="section-kicker">Control areas</p><p className="mt-1 text-[12px] leading-5 text-[var(--text-muted)]">Changes here can affect team access and operational behaviour.</p></div>
          <nav className="space-y-1 p-2">
            {TAB_META.map((tab) => {
              const active = activeTab === tab.id;
              return (
                <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)} aria-current={active ? "page" : undefined} className={`flex min-h-10 w-full items-center gap-3 rounded-[var(--radius-md)] px-3 text-left text-[12px] font-semibold transition ${active ? "bg-[var(--brand-50)] text-[var(--brand-700)]" : "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"}`}>
                  <tab.icon size={16} /><span>{tab.label}</span>
                </button>
              );
            })}
          </nav>
        </aside>

        <main className="min-w-0 page-stack">
          <div className="flex items-center gap-3 border-b border-[var(--border-subtle)] pb-4">
            {currentTab && <span className="grid h-9 w-9 place-items-center rounded-[var(--radius-md)] bg-[var(--brand-50)] text-[var(--brand-700)]"><currentTab.icon size={17} /></span>}
            <div><p className="section-kicker">Current section</p><h2 className="mt-0.5 text-lg font-semibold">{currentTab?.label}</h2></div>
          </div>

          {activeTab === "capabilities" && (
            <section className="surface-panel overflow-hidden" aria-labelledby="capability-matrix-title">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-subtle)] bg-[var(--surface-secondary)] p-5">
                <div><p className="section-kicker">Access matrix</p><h3 id="capability-matrix-title" className="mt-1 section-title">Team capabilities</h3></div>
                <Chip variant="brand" size="sm">{usersList.length} users</Chip>
              </div>
              <div className="space-y-3 p-4 sm:p-5">
                {usersList.length ? usersList.map((user) => {
                  const userCaps = userCapsMap[user.user_id] || [];
                  const highlighted = highlightRowId === user.user_id;
                  return (
                    <article key={user.user_id} className={`rounded-[var(--radius-lg)] border p-4 transition ${highlighted ? "border-[var(--status-success)] bg-[var(--status-success-soft)]" : "border-[var(--border-subtle)] bg-[var(--surface-primary)] hover:border-[var(--border-default)]"}`}>
                      <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
                        <div className="flex min-w-[220px] items-center gap-3">
                          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius-md)] bg-[var(--brand-100)] text-[11px] font-bold text-[var(--brand-800)]">{user.name.slice(0, 2).toUpperCase()}</span>
                          <div className="min-w-0"><p className="truncate text-[13px] font-semibold text-[var(--text-primary)]">{user.name}</p><p className="mt-0.5 truncate text-[11px] text-[var(--text-muted)]">{user.email}</p></div>
                        </div>
                        <div className="grid flex-1 gap-2 sm:grid-cols-2 2xl:grid-cols-3">
                          {ALL_CAPABILITIES.map((capability) => {
                            const checked = userCaps.includes(capability.code);
                            return (
                              <label key={capability.code} className={`flex min-h-9 cursor-pointer items-center gap-2 rounded-[var(--radius-md)] border px-3 text-[11px] font-semibold transition ${checked ? "border-[var(--brand-200)] bg-[var(--brand-50)] text-[var(--brand-700)]" : "border-[var(--border-subtle)] bg-[var(--surface-secondary)] text-[var(--text-secondary)] hover:border-[var(--border-default)]"}`}>
                                <input type="checkbox" checked={checked} onChange={() => handleToggleCapability(user.user_id, capability.code, checked)} className="h-4 w-4 rounded border-[var(--border-strong)] accent-[var(--brand-600)]" />
                                <span>{capability.label}</span>
                              </label>
                            );
                          })}
                        </div>
                        <div className="flex shrink-0 gap-2">
                          <Button size="sm" variant="secondary" onClick={() => { setEditingUser(user); setEditUserForm({ name: user.name, email: user.email, is_active: String(user.is_active) === "1" || String(user.is_active) === "true" }); }} icon={<Edit2 size={13} />}>Edit</Button>
                          <Button size="sm" variant="outline" onClick={() => { setResetPasswordInput(""); setNewPasswordResult(null); setResettingPasswordFor(user.user_id); }} icon={<Key size={13} />}>Password</Button>
                        </div>
                      </div>
                    </article>
                  );
                }) : <EmptyState icon={<Users size={21} />} title="No user accounts" description="Create the first account to begin assigning capabilities." />}
              </div>
            </section>
          )}

          {activeTab === "managers" && (
            <section className="data-table-shell" aria-labelledby="manager-assignment-title">
              <div className="border-b border-[var(--border-subtle)] px-5 py-4"><p className="section-kicker">Reporting structure</p><h3 id="manager-assignment-title" className="mt-1 section-title">Manager assignments</h3><p className="mt-1 text-[12px] text-[var(--text-muted)]">Choose an active user as each team member’s reporting manager.</p></div>
              {usersList.length ? (
                <div className="overflow-x-auto"><table className="min-w-[680px]"><thead><tr><th>Team member</th><th>Account</th><th>Current manager</th></tr></thead><tbody>{usersList.map((user) => <tr key={user.user_id}><td><p className="font-semibold text-[var(--text-primary)]">{user.name}</p></td><td>{String(user.is_active) === "1" || String(user.is_active) === "true" ? <Chip variant="success" size="sm">Active</Chip> : <Chip variant="neutral" size="sm">Inactive</Chip>}</td><td><select aria-label={`Manager for ${user.name}`} value={user.manager_id || ""} onChange={(event) => handleSetManager(user.user_id, event.target.value || null)} className="field-control min-w-[220px]"><option value="">No manager</option>{usersList.filter((manager) => manager.user_id !== user.user_id && (String(manager.is_active) === "1" || String(manager.is_active) === "true")).map((manager) => <option key={manager.user_id} value={manager.user_id}>{manager.name}</option>)}</select></td></tr>)}</tbody></table></div>
              ) : <div className="p-5"><EmptyState icon={<UserCheck size={21} />} title="No users to organise" description="Manager links can be added after user accounts are created." /></div>}
            </section>
          )}

          {activeTab === "task_allocation" && <TaskAllocationWorkspace />}
          {activeTab === "create_user" && <CreateUserPanel />}

          {activeTab === "templates" && (
            <section className="surface-panel overflow-hidden" aria-labelledby="template-settings-title">
              <div className="flex items-center justify-between gap-3 border-b border-[var(--border-subtle)] bg-[var(--surface-secondary)] p-5"><div><p className="section-kicker">Automation library</p><h3 id="template-settings-title" className="mt-1 section-title">Task templates</h3></div><Chip variant="neutral" size="sm">{templates.length} templates</Chip></div>
              <div className="space-y-3 p-4 sm:p-5">
                {templates.length ? templates.map((template) => {
                  const editing = editingTemplate === template.template_id;
                  return (
                    <article key={template.template_id} className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] p-4">
                      {editing ? (
                        <div className="grid gap-4 md:grid-cols-2">
                          <Input label="Template title" value={String(templateEdits.title ?? template.title)} onChange={(event) => setTemplateEdits({ ...templateEdits, title: event.target.value })} />
                          <div><label className="field-label">Default priority</label><select className="field-control" value={String(templateEdits.default_priority ?? template.default_priority)} onChange={(event) => setTemplateEdits({ ...templateEdits, default_priority: event.target.value as LocalTaskTemplate["default_priority"] })}><option>High</option><option>Medium</option><option>Low</option></select></div>
                          <div className="md:col-span-2"><label className="field-label">Description</label><textarea className="field-control resize-y" rows={3} value={String(templateEdits.description ?? template.description ?? "")} onChange={(event) => setTemplateEdits({ ...templateEdits, description: event.target.value })} /></div>
                          <div className="md:col-span-2 flex justify-end gap-2"><Button variant="secondary" size="sm" onClick={() => { setEditingTemplate(null); setTemplateEdits({}); }}>Cancel</Button><Button size="sm" onClick={() => handleSaveTemplate(template.template_id)} icon={<Save size={13} />}>Save template</Button></div>
                        </div>
                      ) : (
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius-md)] bg-[var(--brand-50)] text-[var(--brand-700)]"><ListTodo size={17} /></span>
                          <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="font-semibold text-[var(--text-primary)]">{template.title}</p><Chip variant={template.is_active === 1 ? "success" : "neutral"} size="sm">{template.is_active === 1 ? "Active" : "Disabled"}</Chip><Chip variant="brand" size="sm">{template.default_priority}</Chip></div><p className="mt-1 text-[12px] leading-5 text-[var(--text-muted)]">{template.description || "No description"} · {template.recurrence} · {template.applies_to_capability}</p></div>
                          <div className="flex gap-2"><Button variant="secondary" size="sm" onClick={() => { setEditingTemplate(template.template_id); setTemplateEdits({}); }} icon={<Edit2 size={13} />}>Edit</Button><Button variant="ghost" size="sm" onClick={() => handleToggleTemplate(template)} icon={template.is_active === 1 ? <ToggleRight size={15} /> : <ToggleLeft size={15} />}>{template.is_active === 1 ? "Disable" : "Enable"}</Button></div>
                        </div>
                      )}
                    </article>
                  );
                }) : <EmptyState icon={<ListTodo size={21} />} title="No task templates" description="Templates appear here after they are added to the task engine." />}
              </div>
            </section>
          )}

          {activeTab === "attendance" && (
            <section className="surface-panel overflow-hidden" aria-labelledby="attendance-settings-title">
              <div className="border-b border-[var(--border-subtle)] bg-[var(--surface-secondary)] p-5"><p className="section-kicker">Policy defaults</p><h3 id="attendance-settings-title" className="mt-1 section-title">Attendance settings</h3><p className="mt-1 text-[12px] text-[var(--text-muted)]">These controls preserve the existing local settings behaviour in this frontend.</p></div>
              <div className="max-w-2xl space-y-5 p-5 sm:p-6">
                <div className="grid gap-5 sm:grid-cols-2"><Input label="Shift start" type="time" value={shiftStart} onChange={(event) => setShiftStart(event.target.value)} /><Input label="Grace period (minutes)" type="number" min={0} max={180} value={graceMinutes} onChange={(event) => setGraceMinutes(Number(event.target.value))} /></div>
                {shiftSaved && <div className="alert-panel alert-panel--success" role="status"><CheckCircle2 size={16} /><span>Attendance settings saved for this session.</span></div>}
                <div className="flex justify-end border-t border-[var(--border-subtle)] pt-5"><Button onClick={handleSaveShift} icon={<Save size={14} />}>Save settings</Button></div>
              </div>
            </section>
          )}

          {activeTab === "exports" && (
            <section className="surface-panel overflow-hidden" aria-labelledby="master-export-title">
              <div className="border-b border-[var(--border-subtle)] bg-[var(--surface-secondary)] p-5"><p className="section-kicker">Governed downloads</p><h3 id="master-export-title" className="mt-1 section-title">Master data exports</h3><p className="mt-1 text-[12px] text-[var(--text-muted)]">Generate operational spreadsheets using the existing export functions.</p></div>
              <div className="grid gap-4 p-5 md:grid-cols-3">
                {[
                  ["Sales pipeline", "Leads, stages, ownership, and sales activity.", exportMasterSales],
                  ["Support logs", "Client problems, status, and resolution history.", exportMasterSupport],
                  ["Mapping data", "Distributor-retailer linkage requests and outcomes.", exportMasterMappings],
                ].map(([title, copy, action]) => (
                  <article key={String(title)} className="flex min-h-[190px] flex-col rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--surface-primary)] p-5">
                    <span className="grid h-10 w-10 place-items-center rounded-[var(--radius-md)] bg-[var(--brand-50)] text-[var(--brand-700)]"><Download size={17} /></span>
                    <h4 className="mt-4 text-[14px] font-semibold">{String(title)}</h4><p className="mt-2 flex-1 text-[12px] leading-5 text-[var(--text-muted)]">{String(copy)}</p>
                    <Button variant="outline" size="sm" onClick={() => (action as () => void)()} icon={<Download size={13} />}>Export file</Button>
                  </article>
                ))}
              </div>
            </section>
          )}
        </main>
      </div>

      <Modal open={Boolean(editingUser)} onClose={() => setEditingUser(null)} title="Edit user details" description={editingUser ? `Update the profile and account status for ${editingUser.name}.` : undefined} footer={<><Button variant="secondary" onClick={() => setEditingUser(null)}>Cancel</Button><Button type="submit" form="edit-user-form" isLoading={isUpdatingUser}>Save changes</Button></>}>
        <form id="edit-user-form" onSubmit={handleUpdateUser} className="space-y-4">
          <Input label="Full name" value={editUserForm.name} onChange={(event) => setEditUserForm({ ...editUserForm, name: event.target.value })} required />
          <Input label="Email address" type="email" value={editUserForm.email} onChange={(event) => setEditUserForm({ ...editUserForm, email: event.target.value })} required />
          <label className="flex min-h-11 items-center gap-3 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--surface-secondary)] px-3 text-[12px] font-semibold text-[var(--text-primary)]"><input type="checkbox" checked={editUserForm.is_active} onChange={(event) => setEditUserForm({ ...editUserForm, is_active: event.target.checked })} className="h-4 w-4 rounded accent-[var(--brand-600)]" /> Account active</label>
        </form>
      </Modal>

      <Modal open={Boolean(resettingPasswordFor)} onClose={() => { setResettingPasswordFor(null); setNewPasswordResult(null); }} title="Reset user password" description="Set a temporary credential and share it through an approved secure channel." footer={!newPasswordResult ? <><Button variant="secondary" onClick={() => setResettingPasswordFor(null)}>Cancel</Button><Button isLoading={isResetting} onClick={() => resettingPasswordFor && handleResetPassword(resettingPasswordFor)}>Reset password</Button></> : <Button onClick={() => { setResettingPasswordFor(null); setNewPasswordResult(null); }}>Done</Button>}>
        {newPasswordResult ? (
          <div className="space-y-4"><div className="alert-panel alert-panel--warning"><Key size={16} className="mt-0.5 shrink-0" /><span>This temporary password is shown once. Copy it before closing this dialog.</span></div><div className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-secondary)] p-4 text-center font-mono text-[15px] font-semibold text-[var(--brand-700)]">{newPasswordResult}</div></div>
        ) : <Input label="New password" type="password" placeholder="Leave empty to generate automatically" value={resetPasswordInput} onChange={(event) => setResetPasswordInput(event.target.value)} description="Use at least the minimum length required by the existing API." />}
      </Modal>
    </div>
  );
}
