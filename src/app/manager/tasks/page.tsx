"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { db, transactionalMutation } from "@/lib/db";
import { UserPlus, Send, Users, CalendarDays, AlertCircle, ListPlus, UploadCloud } from "lucide-react";
import type { LocalUser } from "@/lib/db";
import { SearchableSelect } from "@/components/SearchableSelect";
import { TaskAllocationWorkspace } from "@/components/TaskAllocationWorkspace";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Chip } from "@/components/ui/Chip";

type Priority = "High" | "Medium" | "Low";

export default function AssignTaskPage() {
  const { currentUser, isTaskAssigner, allUsers } = useAuth();
  const [users, setUsers] = useState<LocalUser[]>([]);
  const [mode, setMode] = useState<"manual" | "bulk">("manual");
  
  const [form, setForm] = useState({
    assignedTo: "",
    title: "",
    description: "",
    priority: "Medium" as Priority,
    dueDate: new Date().toISOString().slice(0, 10),
  });
  const [submitting, setSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    if (allUsers && allUsers.length > 0) {
      setUsers(allUsers.filter((x) => String(x.is_active) === "1" || String(x.is_active) === "true"));
    }
  }, [allUsers]);

  if (!isTaskAssigner) {
    return (
      <Card className="max-w-md mx-auto mt-16 text-center space-y-4 p-8">
        <AlertCircle size={40} className="mx-auto text-[var(--status-danger)]" />
        <h3 className="text-base font-black text-[var(--text-primary)]">Access Restricted</h3>
        <p className="text-xs text-[var(--text-muted)] font-semibold">
          You don't have access to task assignment.
        </p>
      </Card>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser || !form.assignedTo || !form.title.trim()) return;
    setSubmitting(true);

    const task = {
      task_id: crypto.randomUUID(),
      assigned_to: form.assignedTo,
      assigned_by: currentUser.user_id,
      title: form.title.trim(),
      description: form.description.trim() || null,
      priority: form.priority,
      status: "Pending" as const,
      source: "manual" as const,
      template_id: null,
      related_lead_id: null,
      due_date: form.dueDate,
      started_at: null,
      completed_at: null,
      proof_note: null,
      proof_photo_url: null,
      created_at: new Date().toISOString(),
    };

    await transactionalMutation("tasks", "INSERT", task);

    const assignee = users.find((u) => u.user_id === form.assignedTo);
    setSuccessMsg(`Task assigned to ${assignee?.name || "team member"}.`);
    setTimeout(() => setSuccessMsg(null), 3000);
    setForm((f) => ({ ...f, title: "", description: "", assignedTo: "" }));
    setSubmitting(false);
  };

  return (
    <div className="w-full max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <UserPlus size={20} className="text-[var(--brand-500)]" />
            <h1 className="text-2xl font-black text-[var(--text-primary)]">Assign Tasks</h1>
          </div>
          <p className="text-xs text-[var(--text-muted)] font-semibold mt-1">
            Push manual tasks or allocate targets in bulk via Excel.
          </p>
        </div>
        
        <div className="flex p-1 bg-[var(--surface-secondary)] rounded-[var(--radius-md)] w-fit gap-1.5">
          <button
            onClick={() => setMode("manual")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-sm)] text-xs font-bold transition-all cursor-pointer ${
              mode === "manual" ? "bg-[var(--surface-primary)] text-[var(--brand-500)] shadow-xs" : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            }`}
          >
            <ListPlus size={14} /> Manual Task
          </button>
          <button
            onClick={() => setMode("bulk")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-sm)] text-xs font-bold transition-all cursor-pointer ${
              mode === "bulk" ? "bg-[var(--surface-primary)] text-[var(--brand-500)] shadow-xs" : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            }`}
          >
            <UploadCloud size={14} /> Bulk Excel
          </button>
        </div>
      </div>

      {mode === "manual" ? (
        <div className="space-y-6">
          {successMsg && (
            <div className="p-4 bg-[var(--status-success-soft)] border border-[var(--status-success)]/20 text-[var(--status-success)] rounded-[var(--radius-lg)] text-xs font-bold">
              ✓ {successMsg}
            </div>
          )}

          <Card className="p-6 space-y-4">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-[10px] font-black text-[var(--text-muted)] uppercase tracking-widest mb-1.5">
                  <Users size={12} className="inline mr-1" /> Team Member
                </label>
                <SearchableSelect
                  required
                  placeholder="Select team member..."
                  value={form.assignedTo}
                  onChange={(val) => setForm({ ...form, assignedTo: val })}
                  options={users.map((u) => ({ value: u.user_id, label: u.name }))}
                />
              </div>

              <Input
                label="Task Title"
                required
                placeholder="e.g. Follow up with Metro Store"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />

              <div>
                <label className="block text-[10px] font-black text-[var(--text-muted)] uppercase tracking-widest mb-1.5">
                  Description <span className="normal-case text-[var(--text-disabled)]">(optional)</span>
                </label>
                <textarea
                  rows={3}
                  placeholder="Additional operational context..."
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className="w-full px-3 py-2 bg-[var(--surface-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-sm)] text-xs font-semibold text-[var(--text-primary)] focus:outline-none focus:border-[var(--brand-500)] focus:ring-2 focus:ring-[var(--brand-100)] transition-all resize-none"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-black text-[var(--text-muted)] uppercase tracking-widest mb-1.5">
                    Priority Level
                  </label>
                  <div className="flex gap-2">
                    {(["High", "Medium", "Low"] as Priority[]).map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setForm({ ...form, priority: p })}
                        className={`flex-1 py-2 rounded-[var(--radius-sm)] text-xs font-bold border transition-all cursor-pointer ${
                          form.priority === p
                            ? "bg-[var(--brand-50)] text-[var(--brand-500)] border-[var(--brand-500)]/30"
                            : "bg-[var(--surface-primary)] text-[var(--text-muted)] border-[var(--border-subtle)] hover:border-[var(--border-default)]"
                        }`}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] font-black text-[var(--text-muted)] uppercase tracking-widest mb-1.5">
                    <CalendarDays size={12} className="inline mr-1" /> Target Due Date
                  </label>
                  <input
                    type="date"
                    value={form.dueDate}
                    onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
                    className="w-full px-3 py-2 bg-[var(--surface-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-sm)] text-xs font-bold text-[var(--text-primary)] focus:outline-none focus:border-[var(--brand-500)]"
                  />
                </div>
              </div>

              <Button
                type="submit"
                isLoading={submitting}
                className="w-full h-11"
                icon={<Send size={16} />}
              >
                Assign Task Now
              </Button>
            </form>
          </Card>
        </div>
      ) : (
        <TaskAllocationWorkspace />
      )}
    </div>
  );
}
