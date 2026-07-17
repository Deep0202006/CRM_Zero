"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { db, transactionalMutation } from "@/lib/db";
import { UserPlus, Send, Users, CalendarDays, AlertCircle, ListPlus, UploadCloud } from "lucide-react";
import type { LocalUser } from "@/lib/db";
import { SearchableSelect } from "@/components/SearchableSelect";
import { TaskAllocationWorkspace } from "@/components/TaskAllocationWorkspace";

type Priority = "High" | "Medium" | "Low";

const PRIORITY_COLORS: Record<Priority, string> = {
  High: "text-rose-600 bg-rose-50 border-rose-200",
  Medium: "text-amber-700 bg-amber-50 border-amber-200",
  Low: "text-emerald-600 bg-emerald-50 border-emerald-200",
};

export default function AssignTaskPage() {
  const { currentUser, capabilities, isTaskAssigner } = useAuth();
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
    db.users.toArray().then((u) => setUsers(u.filter((x) => String(x.is_active) === "1" || String(x.is_active) === "true")));
  }, []);

  if (!isTaskAssigner) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4 text-slate-400">
        <AlertCircle size={40} />
        <p className="font-bold text-sm">You don't have access to this page.</p>
      </div>
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
      <div className="w-full space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <UserPlus size={20} className="text-brand-primary" />
              <h1 className="text-2xl font-black text-slate-900">Assign Tasks</h1>
            </div>
            <p className="text-xs text-slate-400 font-semibold mt-1">
              Push manual tasks or allocate targets in bulk via Excel.
            </p>
          </div>
          
          <div className="flex bg-slate-100 p-1 rounded-xl w-fit">
            <button
              onClick={() => setMode("manual")}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-black transition-all ${
                mode === "manual" ? "bg-white text-brand-primary shadow-sm" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              <ListPlus size={14} /> Manual Task
            </button>
            <button
              onClick={() => setMode("bulk")}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-black transition-all ${
                mode === "bulk" ? "bg-white text-brand-primary shadow-sm" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              <UploadCloud size={14} /> Bulk Excel
            </button>
          </div>
        </div>

        {mode === "manual" ? (
          <div className="space-y-6">
            {successMsg && (
              <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl text-emerald-700 text-sm font-bold">
                ✓ {successMsg}
              </div>
            )}

            <form
              onSubmit={handleSubmit}
              className="bg-white border border-slate-100 rounded-3xl shadow-sm p-6 space-y-5"
            >
              {/* Team Member */}
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
                  <Users size={10} className="inline mr-1" />Team Member
                </label>
                <SearchableSelect
                  required
                  placeholder="Select team member…"
                  value={form.assignedTo}
                  onChange={(val) => setForm({ ...form, assignedTo: val })}
                  options={users.map((u) => ({ value: u.user_id, label: u.name }))}
                />
              </div>

              {/* Title */}
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
                  Task Title
                </label>
                <input
                  required
                  placeholder="e.g. Follow up with Metro Grocery Store"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-semibold text-slate-900 placeholder-slate-300 focus:outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/10 transition-all"
                />
              </div>

              {/* Description */}
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
                  Description <span className="text-slate-300 normal-case">(optional)</span>
                </label>
                <textarea
                  rows={2}
                  placeholder="Additional context…"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-semibold text-slate-900 placeholder-slate-300 focus:outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/10 transition-all resize-none"
                />
              </div>

              {/* Priority + Due Date */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
                    Priority
                  </label>
                  <div className="flex gap-2">
                    {(["High", "Medium", "Low"] as Priority[]).map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setForm({ ...form, priority: p })}
                        className={`flex-1 py-2 rounded-xl text-[11px] font-black border transition-all ${
                          form.priority === p
                            ? PRIORITY_COLORS[p]
                            : "text-slate-400 border-slate-200 bg-slate-50 hover:border-slate-300"
                        }`}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
                    <CalendarDays size={10} className="inline mr-1" />Due Date
                  </label>
                  <input
                    type="date"
                    value={form.dueDate}
                    onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-semibold text-slate-900 focus:outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/10 transition-all"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full flex items-center justify-center gap-2 py-3.5 bg-brand-primary hover:bg-brand-secondary text-white font-black rounded-2xl text-xs tracking-wider uppercase transition-all shadow-md shadow-brand-primary/10 disabled:opacity-50 cursor-pointer"
              >
                <Send size={14} />
                {submitting ? "Assigning…" : "Assign Task"}
              </button>
            </form>
          </div>
        ) : (
          <TaskAllocationWorkspace />
        )}
      </div>
  );
}
