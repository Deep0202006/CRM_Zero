"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { transactionalMutation } from "@/lib/db";
import type { LocalUser } from "@/lib/db";
import { UserPlus, Send, Users, CalendarDays, AlertCircle, ListPlus, UploadCloud, Sparkles } from "lucide-react";
import { SearchableSelect } from "@/components/SearchableSelect";
import { TaskAllocationWorkspace } from "@/components/TaskAllocationWorkspace";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { PageHeader } from "@/components/ui/PageHeader";

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
    if (allUsers?.length) {
      setUsers(allUsers.filter((user) => String(user.is_active) === "1" || String(user.is_active) === "true"));
    }
  }, [allUsers]);

  if (!isTaskAssigner) {
    return (
      <section className="access-state" aria-labelledby="task-access-title">
        <span className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-[var(--radius-lg)] bg-[var(--status-danger-soft)] text-[var(--status-danger)]">
          <AlertCircle size={22} />
        </span>
        <h1 id="task-access-title" className="text-lg font-semibold">Task assignment is restricted</h1>
        <p className="mx-auto mt-2 max-w-sm text-[13px] leading-5 text-[var(--text-muted)]">
          Your account does not have the task-assigner capability. Ask an administrator to update your access.
        </p>
      </section>
    );
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!currentUser || !form.assignedTo || !form.title.trim()) return;
    setSubmitting(true);

    try {
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
      const assignee = users.find((user) => user.user_id === form.assignedTo);
      setSuccessMsg(`Task assigned to ${assignee?.name || "team member"}.`);
      window.setTimeout(() => setSuccessMsg(null), 3500);
      setForm((current) => ({ ...current, title: "", description: "", assignedTo: "" }));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="app-page">
      <PageHeader
        eyebrow="Work allocation"
        icon={<UserPlus size={18} />}
        title="Assign team work"
        description="Create focused one-off tasks or distribute city targets from a validated spreadsheet."
        actions={
          <div className="segmented-control" aria-label="Assignment method">
            <button type="button" aria-pressed={mode === "manual"} onClick={() => setMode("manual")}>
              <span className="flex items-center gap-2"><ListPlus size={14} /> Manual task</span>
            </button>
            <button type="button" aria-pressed={mode === "bulk"} onClick={() => setMode("bulk")}>
              <span className="flex items-center gap-2"><UploadCloud size={14} /> Spreadsheet</span>
            </button>
          </div>
        }
      />

      {mode === "manual" ? (
        <div className="workspace-split">
          <section className="surface-panel p-5 sm:p-6" aria-labelledby="manual-task-title">
            <div className="mb-6 flex items-start gap-3 border-b border-[var(--border-subtle)] pb-5">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius-md)] bg-[var(--brand-50)] text-[var(--brand-700)]">
                <ListPlus size={18} />
              </span>
              <div>
                <h2 id="manual-task-title" className="section-title">Task details</h2>
                <p className="mt-1 text-[12px] leading-5 text-[var(--text-muted)]">The assignee will see this in My Day immediately after sync.</p>
              </div>
            </div>

            {successMsg && (
              <div className="alert-panel alert-panel--success mb-5" role="status">
                <Sparkles size={16} className="mt-0.5 shrink-0" />
                <span>{successMsg}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="field-label"><Users size={13} className="mr-1 inline" /> Team member</label>
                <SearchableSelect
                  required
                  placeholder="Search an active team member"
                  value={form.assignedTo}
                  onChange={(value) => setForm({ ...form, assignedTo: value })}
                  options={users.map((user) => ({ value: user.user_id, label: user.name }))}
                />
              </div>

              <Input
                label="Task title"
                required
                placeholder="Example: Follow up with Metro Store"
                value={form.title}
                onChange={(event) => setForm({ ...form, title: event.target.value })}
              />

              <div>
                <label htmlFor="task-description" className="field-label">Description <span className="font-normal text-[var(--text-muted)]">(optional)</span></label>
                <textarea
                  id="task-description"
                  rows={4}
                  placeholder="Add the context required to complete this task correctly."
                  value={form.description}
                  onChange={(event) => setForm({ ...form, description: event.target.value })}
                  className="field-control resize-y"
                />
              </div>

              <div className="grid gap-5 sm:grid-cols-2">
                <fieldset>
                  <legend className="field-label">Priority</legend>
                  <div className="segmented-control grid w-full grid-cols-3">
                    {(["High", "Medium", "Low"] as Priority[]).map((priority) => (
                      <button
                        key={priority}
                        type="button"
                        aria-pressed={form.priority === priority}
                        onClick={() => setForm({ ...form, priority })}
                      >
                        {priority}
                      </button>
                    ))}
                  </div>
                </fieldset>

                <Input
                  label="Target due date"
                  type="date"
                  leftIcon={<CalendarDays size={15} />}
                  value={form.dueDate}
                  onChange={(event) => setForm({ ...form, dueDate: event.target.value })}
                />
              </div>

              <div className="flex justify-end border-t border-[var(--border-subtle)] pt-5">
                <Button type="submit" isLoading={submitting} icon={<Send size={15} />} disabled={!form.assignedTo || !form.title.trim()}>
                  Assign task
                </Button>
              </div>
            </form>
          </section>

          <aside className="surface-panel overflow-hidden" aria-label="Assignment guidance">
            <div className="border-b border-[var(--border-subtle)] bg-[var(--surface-secondary)] p-5">
              <p className="section-kicker">Before assigning</p>
              <h2 className="mt-1 text-base font-semibold">Make the next action unmistakable</h2>
            </div>
            <div className="space-y-5 p-5">
              {[
                ["01", "Use an action-led title", "Start with a verb and name the customer, task, or expected result."],
                ["02", "Add only useful context", "Include constraints, proof requirements, or contact details the assignee cannot infer."],
                ["03", "Choose a realistic due date", "Urgency should be visible in priority; the due date should remain achievable."],
              ].map(([number, title, copy]) => (
                <div key={number} className="flex gap-3">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-secondary)] text-[10px] font-bold text-[var(--brand-700)]">{number}</span>
                  <div>
                    <p className="text-[13px] font-semibold text-[var(--text-primary)]">{title}</p>
                    <p className="mt-1 text-[12px] leading-5 text-[var(--text-muted)]">{copy}</p>
                  </div>
                </div>
              ))}
            </div>
          </aside>
        </div>
      ) : (
        <TaskAllocationWorkspace />
      )}
    </div>
  );
}
