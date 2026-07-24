"use client";

import React, { useState, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { db, LocalUser, LocalUserCapability, LocalTaskTemplate } from "@/lib/db";
import {
  ShieldCheck, User, Users, CheckSquare, Sparkles, Activity, AlertCircle,
  ListTodo, UserCheck, Clock as ClockIcon, Edit2, Save, ToggleLeft, ToggleRight, Download, UserPlus, Key, UploadCloud, CheckCircle2, RefreshCw
} from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { exportPipelineToExcel } from "@/lib/pipelineExport";
import { exportClientQueriesToExcel } from "@/lib/clientQueriesExport";
import { exportMasterSales, exportMasterSupport, exportMasterMappings } from "@/lib/excelExport";
import { CreateUserPanel } from "@/components/admin/CreateUserPanel";
import { TaskAllocationWorkspace } from "@/components/TaskAllocationWorkspace";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Chip } from "@/components/ui/Chip";

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
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to update user");
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
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to update manager assignment.");
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

  const handleSaveShift = () => {
    setShiftSaved(true);
    setTimeout(() => setShiftSaved(false), 2000);
  };

  if (!isAdmin) {
    return (
      <Card className="max-w-md mx-auto mt-16 text-center space-y-4 p-8">
        <AlertCircle size={40} className="mx-auto text-[var(--status-danger)]" />
        <h3 className="text-base font-black text-[var(--text-primary)]">Access Restricted</h3>
        <p className="text-xs text-[var(--text-muted)] font-semibold">
          Requires Administrator capabilities to view Admin Control console.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-6 w-full max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-[var(--text-primary)]">Admin Control Panel</h1>
          <p className="text-xs text-[var(--text-muted)] font-bold uppercase tracking-wider">
            User Capabilities & System Configuration
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={() => {
              if (currentUser) exportPipelineToExcel(currentUser.user_id, true);
            }}
            icon={<Download size={14} />}
          >
            Pipeline
          </Button>
          <Button
            size="sm"
            onClick={() => {
              if (currentUser) exportClientQueriesToExcel(currentUser.user_id, true);
            }}
            icon={<Download size={14} />}
          >
            Queries
          </Button>
        </div>
      </div>

      {successMsg && (
        <div className="p-4 bg-[var(--status-success-soft)] border border-[var(--status-success)]/20 text-[var(--status-success)] rounded-[var(--radius-lg)] text-xs font-bold">
          ✓ {successMsg}
        </div>
      )}
      {errorMsg && (
        <div className="p-4 bg-[var(--status-danger-soft)] border border-[var(--status-danger)]/20 text-[var(--status-danger)] rounded-[var(--radius-lg)] text-xs font-bold flex items-center gap-2">
          <AlertCircle size={16} /> {errorMsg}
        </div>
      )}

      {/* Tab bar */}
      <div className="flex gap-1.5 p-1 bg-[var(--surface-secondary)] rounded-[var(--radius-md)] overflow-x-auto scrollbar-hide">
        {TAB_META.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-[var(--radius-sm)] text-xs font-bold whitespace-nowrap transition-all cursor-pointer ${
              activeTab === tab.id
                ? "bg-[var(--surface-primary)] text-[var(--brand-500)] shadow-xs"
                : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            }`}
          >
            <tab.icon size={14} />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Capability Matrix Tab */}
      {activeTab === "capabilities" && (
        <Card className="space-y-4 p-6">
          <div className="flex justify-between items-center border-b border-[var(--border-subtle)] pb-3">
            <h2 className="text-sm font-black text-[var(--text-primary)] flex items-center gap-2">
              <Users size={16} className="text-[var(--brand-500)]" /> Active Team Directory
            </h2>
            <Chip variant="brand" size="sm">
              {usersList.length} User Entries
            </Chip>
          </div>

          <div className="space-y-3">
            {usersList.map((user) => {
              const userCaps = userCapsMap[user.user_id] || [];
              const isHighlighted = highlightRowId === user.user_id;
              return (
                <div
                  key={user.user_id}
                  className={`p-4 rounded-[var(--radius-md)] border transition-all ${
                    isHighlighted
                      ? "border-[var(--status-success)] bg-[var(--status-success-soft)]"
                      : "bg-[var(--surface-secondary)] border-[var(--border-subtle)] hover:border-[var(--border-default)]"
                  }`}
                >
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                    <div className="flex items-center space-x-3 min-w-[200px]">
                      <div className="h-8 w-8 rounded-full bg-[var(--brand-500)] text-white flex items-center justify-center text-xs font-black shrink-0">
                        {user.name.substring(0, 2).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <h3 className="text-xs font-black text-[var(--text-primary)] truncate">{user.name}</h3>
                        <p className="text-[10px] text-[var(--text-muted)] font-semibold truncate">{user.email}</p>
                      </div>
                    </div>
                    
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          setEditingUser(user);
                          setEditUserForm({
                            name: user.name,
                            email: user.email,
                            is_active: String(user.is_active) === "1" || String(user.is_active) === "true",
                          });
                        }}
                      >
                        Edit User
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setResetPasswordInput("");
                          setResettingPasswordFor(user.user_id);
                        }}
                      >
                        Reset PW
                      </Button>
                    </div>
                    
                    <div className="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {ALL_CAPABILITIES.map((cap) => {
                        const hasCap = userCaps.includes(cap.code);
                        return (
                          <label
                            key={cap.code}
                            className={`flex items-center gap-1.5 p-1.5 rounded-[var(--radius-sm)] border text-[10px] font-bold cursor-pointer transition-all ${
                              hasCap
                                ? "bg-[var(--brand-50)] text-[var(--brand-500)] border-[var(--brand-500)]/30"
                                : "bg-[var(--surface-primary)] text-[var(--text-muted)] border-[var(--border-subtle)]"
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={hasCap}
                              onChange={() => handleToggleCapability(user.user_id, cap.code, hasCap)}
                              className="rounded border-[var(--border-default)] text-[var(--brand-500)] focus:ring-[var(--brand-500)]"
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
        </Card>
      )}

      {/* Task Allocation Workspace Tab */}
      {activeTab === "task_allocation" && <TaskAllocationWorkspace />}

      {/* Create User Tab */}
      {activeTab === "create_user" && <CreateUserPanel />}

      {/* Master Exports Tab */}
      {activeTab === "exports" && (
        <Card className="space-y-4 p-6">
          <h2 className="text-sm font-black text-[var(--text-primary)] border-b border-[var(--border-subtle)] pb-3">
            Master Data Exports
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Button
              variant="outline"
              onClick={() => exportMasterSales()}
              icon={<Download size={14} />}
              className="h-11"
            >
              Export Sales Pipeline
            </Button>
            <Button
              variant="outline"
              onClick={() => exportMasterSupport()}
              icon={<Download size={14} />}
              className="h-11"
            >
              Export Support Logs
            </Button>
            <Button
              variant="outline"
              onClick={() => exportMasterMappings()}
              icon={<Download size={14} />}
              className="h-11"
            >
              Export Mappings Data
            </Button>
          </div>
        </Card>
      )}

      {/* Edit User Modal */}
      {editingUser && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs z-[var(--z-modal)] flex items-center justify-center p-4">
          <Card className="w-full max-w-sm p-6 space-y-4">
            <h3 className="text-base font-black text-[var(--text-primary)]">Edit User Details</h3>
            <form onSubmit={handleUpdateUser} className="space-y-3">
              <Input
                label="Full Name"
                value={editUserForm.name}
                onChange={(e) => setEditUserForm({ ...editUserForm, name: e.target.value })}
                required
              />
              <Input
                label="Email Address"
                type="email"
                value={editUserForm.email}
                onChange={(e) => setEditUserForm({ ...editUserForm, email: e.target.value })}
                required
              />
              <label className="flex items-center gap-2 text-xs font-bold text-[var(--text-primary)] pt-1">
                <input
                  type="checkbox"
                  checked={editUserForm.is_active}
                  onChange={(e) => setEditUserForm({ ...editUserForm, is_active: e.target.checked })}
                  className="rounded border-[var(--border-default)] text-[var(--brand-500)]"
                />
                <span>Account Active</span>
              </label>
              <div className="flex gap-2 pt-2">
                <Button variant="secondary" className="flex-1" type="button" onClick={() => setEditingUser(null)}>
                  Cancel
                </Button>
                <Button type="submit" isLoading={isUpdatingUser} className="flex-1">
                  Save Changes
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {/* Password Reset Modal */}
      {resettingPasswordFor && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs z-[var(--z-modal)] flex items-center justify-center p-4">
          <Card className="w-full max-w-sm p-6 space-y-4">
            <h3 className="text-base font-black text-[var(--text-primary)]">Reset Password</h3>
            {newPasswordResult ? (
              <div className="space-y-3">
                <p className="text-xs text-[var(--text-muted)]">Temporary password set successfully:</p>
                <div className="p-3 bg-[var(--surface-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] font-mono text-center font-black text-sm text-[var(--brand-500)]">
                  {newPasswordResult}
                </div>
                <Button size="sm" className="w-full" onClick={() => setResettingPasswordFor(null)}>
                  Done
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <Input
                  label="New Password (Optional)"
                  type="password"
                  placeholder="Leave empty for auto-generated password"
                  value={resetPasswordInput}
                  onChange={(e) => setResetPasswordInput(e.target.value)}
                />
                <div className="flex gap-2 pt-2">
                  <Button variant="secondary" className="flex-1" onClick={() => setResettingPasswordFor(null)}>
                    Cancel
                  </Button>
                  <Button
                    isLoading={isResetting}
                    className="flex-1"
                    onClick={() => handleResetPassword(resettingPasswordFor)}
                  >
                    Reset Password
                  </Button>
                </div>
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
