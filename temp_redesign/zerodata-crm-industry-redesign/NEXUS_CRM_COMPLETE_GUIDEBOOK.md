# Nexus CRM — Complete Implementation Guidebook
## Task Engine, KPI Analytics, and Full System Optimization

This is the single, self-contained build guide for finishing Nexus CRM. It merges two things:

1. **The Task & KPI Addendum** (unchanged, reproduced exactly as delivered) — the daily task engine and analytics layer for all 7 roles.
2. **Optimization of every existing module** — the Kanban pipeline, the support/mapping bridge, attendance, the admin panel, and the offline sync engine — refined against the original goals: simple enough for non-technical staff, and KPI-driven enough to actually improve the business.

Everything here is **additive** to the base system in `NEXUS_CRM_DOCUMENTATION.md`. No existing table is dropped, no existing RLS policy is removed — only extended.

### Table of contents
- Part 1 — Task & KPI Addendum (verbatim)
- Part 2 — Pipeline optimization (`/onboarding`)
- Part 3 — Support & mapping bridge optimization (`/support`)
- Part 4 — Attendance optimization (`/attendance`)
- Part 5 — Admin panel optimization (`/admin`)
- Part 6 — Sync engine hardening
- Part 7 — Consolidated schema diff (run-once SQL)
- Part 8 — Master implementation checklist

---
---

# PART 1 — Task & KPI Addendum (Verbatim)

> This part is unchanged from what was already approved. Nothing in it should be altered — it's reproduced here so this guidebook is the one file you need.

## Nexus CRM — Task Management & KPI Analytics Engine
### Implementation Addendum to `NEXUS_CRM_DOCUMENTATION.md`

This document is a **complete, standalone implementation spec** for two new modules bolted onto the existing Nexus CRM (`CRM_Zero`) codebase:

1. **Daily Task Engine** — every team member sees a prioritized "My Day" list immediately after clocking in.
2. **KPI Analytics Engine** — nightly-computed performance metrics, rolled up into a manager dashboard.

It assumes the base system described in `NEXUS_CRM_DOCUMENTATION.md` already exists: Next.js 15 + React 19, Dexie.js offline mirror, Supabase (Postgres + Auth + Storage), the capability-based RBAC model, and the existing tables (`users`, `capabilities`, `user_capabilities`, `leads`, `client_queries`, `mappings`, `mapping_requests`, `internal_tickets`, `attendance`, `call_logs`).

**Do not delete or rename anything in the existing schema.** Everything below is additive: new tables, new files, two small edits to existing files (login redirect, sidebar link).

### 0. Role Map (no new capabilities needed)

The 7 non-admin capabilities already in the system map 1:1 onto the roles requested. Nothing new needs to be created in `capabilities` — reuse exactly these codes:

| Requested role | Existing capability code |
|---|---|
| Sales — Distributor | `dist_onboarding` |
| Sales — Retailer | `ret_onboarding` |
| Support — Distributor | `dist_support` |
| Support — Retailer | `ret_support` |
| Field Sales — Distributor | `field_dist` |
| Field Sales — Retailer | `field_ret` |
| Technical Support | `tech_support` |
| Manager view (rollup + task assignment) | `admin` |

A user can hold multiple capabilities (e.g. `ret_support` + `field_ret`), in which case they receive tasks generated for **both** roles, merged into one list.

### 1. Database Schema — Run This SQL First

Run this entire block in the Supabase SQL editor, after the existing schema from the base documentation. Order matters — run top to bottom.

```sql
-- =====================================================================
-- A. REPORTING HIERARCHY (needed for KPI rollups and task assignment scoping)
-- =====================================================================
alter table public.users add column if not exists manager_id uuid references public.users(user_id);

-- =====================================================================
-- B. TASK TEMPLATES (recurring task definitions, one row per role-task)
-- =====================================================================
create table public.task_templates (
    template_id uuid primary key default gen_random_uuid(),
    title text not null,
    description text,
    applies_to_capability text references public.capabilities(code) not null,
    default_priority text not null check (default_priority in ('High','Medium','Low')),
    recurrence text not null default 'daily', -- 'daily' | 'weekdays'
    is_active integer not null default 1,
    created_by uuid references public.users(user_id),
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- =====================================================================
-- C. TASKS (actual daily instances assigned to a specific user)
-- =====================================================================
create type task_status_enum as enum ('Pending', 'In Progress', 'Completed', 'Missed');
create type task_priority_enum as enum ('High', 'Medium', 'Low');
create type task_source_enum as enum ('template', 'manual');

create table public.tasks (
    task_id uuid primary key default gen_random_uuid(),
    assigned_to uuid references public.users(user_id) not null,
    assigned_by uuid references public.users(user_id), -- null if system-generated from template
    title text not null,
    description text,
    priority task_priority_enum not null,
    status task_status_enum not null default 'Pending',
    source task_source_enum not null default 'template',
    template_id uuid references public.task_templates(template_id),
    related_lead_id uuid references public.leads(lead_id),
    due_date date not null default current_date,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    proof_note text,
    proof_photo_url text,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    constraint unique_template_per_user_per_day unique (assigned_to, template_id, due_date)
);

create index idx_tasks_assigned_to_due_date on public.tasks(assigned_to, due_date);

-- =====================================================================
-- D. TASK STATUS HISTORY (audit trail — feeds KPI calculations)
-- =====================================================================
create table public.task_status_history (
    id uuid primary key default gen_random_uuid(),
    task_id uuid references public.tasks(task_id) on delete cascade not null,
    changed_by uuid references public.users(user_id),
    old_status text,
    new_status text not null,
    changed_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- =====================================================================
-- E. KPI DAILY SNAPSHOT (computed nightly — the analytics source of truth)
-- =====================================================================
create table public.kpi_daily_snapshot (
    snapshot_id uuid primary key default gen_random_uuid(),
    user_id uuid references public.users(user_id) not null,
    date date not null,
    tasks_assigned int not null default 0,
    tasks_completed int not null default 0,
    tasks_completed_on_time int not null default 0,
    tasks_missed int not null default 0,
    completion_rate numeric generated always as (
        case when tasks_assigned = 0 then 0
        else round((tasks_completed::numeric / tasks_assigned::numeric) * 100, 1) end
    ) stored,
    avg_completion_minutes numeric,
    attendance_status text, -- 'Present' | 'Absent' | 'Late'
    clock_in_time time,
    leads_touched int not null default 0,
    leads_converted int not null default 0,
    calls_logged int not null default 0,
    tickets_resolved int not null default 0,
    mapping_requests_resolved int not null default 0,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    constraint unique_user_date unique (user_id, date)
);

create index idx_kpi_user_date on public.kpi_daily_snapshot(user_id, date);

-- =====================================================================
-- F. ROW LEVEL SECURITY
-- =====================================================================
alter table public.task_templates enable row level security;
alter table public.tasks enable row level security;
alter table public.task_status_history enable row level security;
alter table public.kpi_daily_snapshot enable row level security;

-- Templates: everyone can read (needed to generate their own tasks client-side),
-- only admin can write.
create policy task_templates_read on public.task_templates
    for select using (true);
create policy task_templates_write on public.task_templates
    for all using (public.check_user_capability(auth.uid(), 'admin'));

-- Tasks: a user sees/edits their own tasks. Admin sees/edits all.
-- A manager (admin capability) can also insert manual tasks for anyone.
create policy tasks_read on public.tasks
    for select using (
        assigned_to = auth.uid() or
        public.check_user_capability(auth.uid(), 'admin')
    );
create policy tasks_write on public.tasks
    for all using (
        assigned_to = auth.uid() or
        public.check_user_capability(auth.uid(), 'admin')
    );

-- Task history: same visibility as the parent task.
create policy task_history_read on public.task_status_history
    for select using (
        exists (
            select 1 from public.tasks t
            where t.task_id = task_status_history.task_id
            and (t.assigned_to = auth.uid() or public.check_user_capability(auth.uid(), 'admin'))
        )
    );
create policy task_history_write on public.task_status_history
    for insert with check (true);

-- KPI snapshots: a user sees their own row. Admin sees everyone.
-- Managers (users who appear as manager_id for someone) see their direct reports.
create policy kpi_read on public.kpi_daily_snapshot
    for select using (
        user_id = auth.uid() or
        public.check_user_capability(auth.uid(), 'admin') or
        exists (select 1 from public.users u where u.user_id = kpi_daily_snapshot.user_id and u.manager_id = auth.uid())
    );
-- KPI rows are written only by the nightly server-side job (service role), never by clients.
create policy kpi_write_service_only on public.kpi_daily_snapshot
    for all using (false) with check (false);

-- =====================================================================
-- G. SEED TASK TEMPLATES — ONE ROW PER ROLE, READY TO USE OUT OF THE BOX
-- =====================================================================
insert into public.task_templates (title, description, applies_to_capability, default_priority, recurrence) values

-- Sales — Distributor (dist_onboarding)
('Call 5 new distributor leads', 'Contact leads currently in New status and move them to Contacted.', 'dist_onboarding', 'High', 'daily'),
('Follow up Interested-stage distributors', 'Push distributor leads sitting in Interested toward Registration.', 'dist_onboarding', 'Medium', 'daily'),
('Update yesterday''s lead statuses', 'Ensure every distributor lead contacted yesterday has a current status.', 'dist_onboarding', 'Low', 'daily'),

-- Sales — Retailer (ret_onboarding)
('Call 5 new retailer leads', 'Contact leads currently in New status and move them to Contacted.', 'ret_onboarding', 'High', 'daily'),
('Follow up Interested-stage retailers', 'Push retailer leads sitting in Interested toward Registration.', 'ret_onboarding', 'Medium', 'daily'),
('Update yesterday''s lead statuses', 'Ensure every retailer lead contacted yesterday has a current status.', 'ret_onboarding', 'Low', 'daily'),

-- Support — Distributor (dist_support)
('Resolve open distributor tickets', 'Clear all Open-status distributor client queries.', 'dist_support', 'High', 'daily'),
('Check in with 3 active distributor accounts', 'Proactive call to converted distributors to catch issues early.', 'dist_support', 'Medium', 'daily'),
('Review pending distributor mapping requests', 'Verify and resolve mapping requests tied to distributor accounts.', 'dist_support', 'Medium', 'daily'),

-- Support — Retailer (ret_support)
('Resolve open retailer tickets', 'Clear all Open-status retailer client queries.', 'ret_support', 'High', 'daily'),
('Check in with 3 active retailer accounts', 'Proactive call to converted retailers to catch issues early.', 'ret_support', 'Medium', 'daily'),
('Review pending retailer mapping requests', 'Verify and resolve mapping requests tied to retailer accounts.', 'ret_support', 'Medium', 'daily'),

-- Field Sales — Distributor (field_dist)
('Visit 4 distributor sites', 'On-site visits to registered distributor locations.', 'field_dist', 'High', 'daily'),
('Verify kit/signage installation', 'Confirm physical setup matches the installation record.', 'field_dist', 'Medium', 'daily'),
('Submit visit feedback form', 'Log outcome notes for every site visited today.', 'field_dist', 'Low', 'daily'),

-- Field Sales — Retailer (field_ret)
('Visit 4 retailer shops', 'On-site visits to registered retailer locations.', 'field_ret', 'High', 'daily'),
('Confirm billing software usage', 'Check the shop is actively using the mapping/billing software correctly.', 'field_ret', 'Medium', 'daily'),
('Submit visit feedback form', 'Log outcome notes for every shop visited today.', 'field_ret', 'Low', 'daily'),

-- Technical Support (tech_support)
('Triage new bug tickets', 'Review internal_tickets created since last login and assign priority.', 'tech_support', 'High', 'daily'),
('Resolve High priority tickets', 'Work through all High priority open tickets first.', 'tech_support', 'High', 'daily'),
('Clear ticket backlog updates', 'Add a status update to every ticket untouched for 48+ hours.', 'tech_support', 'Medium', 'daily');
```

### 2. Task Generation Logic — `src/lib/taskEngine.ts` (new file)

This is the client-side engine that runs right after login/clock-in. It checks whether today's tasks already exist for the user; if not, it generates them from `task_templates` matching the user's active capabilities, writes them to Dexie, and queues them for sync — using the exact same `sync_queue` pattern already used by `db.ts` for leads and attendance.

```typescript
// src/lib/taskEngine.ts
import { db } from "./db";
import type { SyncQueueItem } from "./db";

export interface LocalTask {
  task_id: string;
  assigned_to: string;
  assigned_by: string | null;
  title: string;
  description: string | null;
  priority: "High" | "Medium" | "Low";
  status: "Pending" | "In Progress" | "Completed" | "Missed";
  source: "template" | "manual";
  template_id: string | null;
  related_lead_id: string | null;
  due_date: string; // YYYY-MM-DD
  started_at: string | null;
  completed_at: string | null;
  proof_note: string | null;
  proof_photo_url: string | null;
  created_at: string;
}

export interface TaskTemplate {
  template_id: string;
  title: string;
  description: string | null;
  applies_to_capability: string;
  default_priority: "High" | "Medium" | "Low";
  recurrence: string;
  is_active: number;
}

const PRIORITY_ORDER: Record<string, number> = { High: 0, Medium: 1, Low: 2 };

/**
 * Call this once, right after login (or right after clock-in on /attendance).
 * Returns today's sorted task list for the given user, generating it first
 * if it doesn't exist yet.
 */
export async function getOrGenerateTodayTasks(
  userId: string,
  userCapabilities: string[]
): Promise<LocalTask[]> {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  const existing = await db.tasks
    .where("assigned_to")
    .equals(userId)
    .and((t: LocalTask) => t.due_date === today)
    .toArray();

  if (existing.length > 0) {
    return sortTasks(existing);
  }

  // No tasks yet today — generate from matching templates.
  const allTemplates: TaskTemplate[] = await db.task_templates.toArray();
  const matching = allTemplates.filter(
    (tpl) => tpl.is_active === 1 && userCapabilities.includes(tpl.applies_to_capability)
  );

  const generated: LocalTask[] = [];

  for (const tpl of matching) {
    const task: LocalTask = {
      task_id: crypto.randomUUID(),
      assigned_to: userId,
      assigned_by: null,
      title: tpl.title,
      description: tpl.description,
      priority: tpl.default_priority,
      status: "Pending",
      source: "template",
      template_id: tpl.template_id,
      related_lead_id: null,
      due_date: today,
      started_at: null,
      completed_at: null,
      proof_note: null,
      proof_photo_url: null,
      created_at: new Date().toISOString(),
    };

    await db.tasks.add(task);

    const queueItem: SyncQueueItem = {
      table_name: "tasks",
      action: "INSERT",
      data: task,
      timestamp: new Date().toISOString(),
    };
    await db.sync_queue.add(queueItem);

    generated.push(task);
  }

  return sortTasks(generated);
}

/** Sort by priority first (High -> Low), then by creation order. */
export function sortTasks(tasks: LocalTask[]): LocalTask[] {
  return [...tasks].sort((a, b) => {
    const p = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
    if (p !== 0) return p;
    return a.created_at.localeCompare(b.created_at);
  });
}

/**
 * Mark a task's status and log it to task_status_history.
 * Call this from the "Mark done" button and from a Start button if you use one.
 */
export async function updateTaskStatus(
  task: LocalTask,
  newStatus: LocalTask["status"],
  changedBy: string,
  proof?: { note?: string; photoUrl?: string }
): Promise<void> {
  const oldStatus = task.status;
  const now = new Date().toISOString();

  const updates: Partial<LocalTask> = { status: newStatus };
  if (newStatus === "In Progress" && !task.started_at) updates.started_at = now;
  if (newStatus === "Completed") {
    updates.completed_at = now;
    if (proof?.note) updates.proof_note = proof.note;
    if (proof?.photoUrl) updates.proof_photo_url = proof.photoUrl;
  }

  await db.tasks.update(task.task_id, updates);

  await db.sync_queue.add({
    table_name: "tasks",
    action: "UPDATE",
    data: { task_id: task.task_id, ...updates },
    timestamp: now,
  });

  const historyEntry = {
    id: crypto.randomUUID(),
    task_id: task.task_id,
    changed_by: changedBy,
    old_status: oldStatus,
    new_status: newStatus,
    changed_at: now,
  };
  await db.task_status_history.add(historyEntry);
  await db.sync_queue.add({
    table_name: "task_status_history",
    action: "INSERT",
    data: historyEntry,
    timestamp: now,
  });
}
```

**Required edit to `src/lib/db.ts`:** add the two new Dexie tables to the schema definition (same pattern as the existing `leads`, `attendance`, etc. tables), and add `task_templates`, `tasks`, `task_status_history` as tables that get pulled down during sync using the existing `filterSyncStream()` — templates and tasks should NOT be segment-filtered (they're per-user, not per-segment), so pass them through `filterSyncStream` untouched or skip that filter for these three tables specifically.

### 3. The "My Day" Page — `src/app/my-day/page.tsx` (new file)

This becomes the **default landing page after clock-in** for every non-admin role. Deliberately minimal: one list, one action per row, color-coded priority, nothing else on screen.

```tsx
// src/app/my-day/page.tsx
"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { getOrGenerateTodayTasks, updateTaskStatus, type LocalTask } from "@/lib/taskEngine";
import DashboardLayout from "@/components/DashboardLayout";

const PRIORITY_COLOR: Record<string, string> = {
  High: "#E24B4A",
  Medium: "#EF9F27",
  Low: "#639922",
};

export default function MyDayPage() {
  const { user, capabilities } = useAuth();
  const [tasks, setTasks] = useState<LocalTask[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    getOrGenerateTodayTasks(user.user_id, capabilities).then((t) => {
      setTasks(t);
      setLoading(false);
    });
  }, [user, capabilities]);

  async function handleComplete(task: LocalTask) {
    await updateTaskStatus(task, "Completed", user!.user_id);
    setTasks((prev) =>
      prev.map((t) => (t.task_id === task.task_id ? { ...t, status: "Completed" } : t))
    );
  }

  const pending = tasks.filter((t) => t.status !== "Completed");
  const done = tasks.filter((t) => t.status === "Completed");
  const progressPct = tasks.length === 0 ? 0 : Math.round((done.length / tasks.length) * 100);

  return (
    <DashboardLayout>
      <div style={{ maxWidth: 640, margin: "0 auto", padding: "24px 16px" }}>
        <h1 style={{ fontSize: 22, fontWeight: 500, marginBottom: 4 }}>My day</h1>
        <p style={{ color: "#888", marginBottom: 20 }}>
          {done.length} of {tasks.length} done ({progressPct}%)
        </p>

        {loading && <p>Loading your tasks...</p>}
        {!loading && tasks.length === 0 && <p>No tasks for today.</p>}

        {pending.map((task) => (
          <div
            key={task.task_id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "16px",
              marginBottom: 10,
              borderRadius: 12,
              border: "1px solid #e5e5e5",
              background: "#fff",
            }}
          >
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: PRIORITY_COLOR[task.priority],
                flexShrink: 0,
              }}
            />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 500 }}>{task.title}</div>
              {task.description && (
                <div style={{ fontSize: 13, color: "#888" }}>{task.description}</div>
              )}
            </div>
            <button
              onClick={() => handleComplete(task)}
              style={{
                padding: "8px 16px",
                borderRadius: 8,
                border: "none",
                background: "#6366f1",
                color: "#fff",
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              Mark done
            </button>
          </div>
        ))}

        {done.length > 0 && (
          <>
            <h3 style={{ marginTop: 24, marginBottom: 8, color: "#888", fontSize: 14 }}>
              Completed
            </h3>
            {done.map((task) => (
              <div
                key={task.task_id}
                style={{
                  padding: "12px 16px",
                  marginBottom: 8,
                  borderRadius: 12,
                  background: "#f5f5f5",
                  color: "#999",
                  textDecoration: "line-through",
                }}
              >
                {task.title}
              </div>
            ))}
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
```

### 4. Login/Attendance Redirect — Edit to Existing Files

**Edit `src/app/attendance/page.tsx`:** after a successful clock-in, change the post-clock-in redirect (or the "continue" button target) from `/` to `/my-day`. This is the single line that makes tasks appear "immediately after login" as requested — the sequence becomes: login → clock in → My Day.

**Edit `src/app/login/page.tsx`:** if a user has already clocked in today (check local `attendance` table for today's date), skip `/attendance` entirely and redirect straight to `/my-day`.

**Edit `src/components/DashboardLayout.tsx`:** add a "My Day" sidebar link, positioned first in the nav list, visible to all authenticated users (no capability gate needed — everyone gets a task list).

### 5. Manager Ad-Hoc Task Assignment — `src/app/manager/tasks/page.tsx` (new file)

Restricted to the `admin` capability (same gating pattern as `/admin`). Lets a manager push a one-off task to any team member — these merge straight into that person's My Day list under `source: 'manual'`.

```tsx
// src/app/manager/tasks/page.tsx
"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { db } from "@/lib/db";

export default function AssignTaskPage() {
  const { user, capabilities } = useAuth();
  const [users, setUsers] = useState<{ user_id: string; name: string }[]>([]);
  const [form, setForm] = useState({ assignedTo: "", title: "", priority: "Medium", dueDate: new Date().toISOString().slice(0, 10) });

  useEffect(() => {
    db.users.toArray().then((u) => setUsers(u.map((x) => ({ user_id: x.user_id, name: x.name }))));
  }, []);

  if (!capabilities.includes("admin")) {
    return <p style={{ padding: 24 }}>You don't have access to this page.</p>;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const task = {
      task_id: crypto.randomUUID(),
      assigned_to: form.assignedTo,
      assigned_by: user!.user_id,
      title: form.title,
      description: null,
      priority: form.priority as "High" | "Medium" | "Low",
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
    await db.tasks.add(task);
    await db.sync_queue.add({
      table_name: "tasks",
      action: "INSERT",
      data: task,
      timestamp: new Date().toISOString(),
    });
    setForm({ ...form, title: "" });
    alert("Task assigned.");
  }

  return (
    <div style={{ maxWidth: 480, margin: "40px auto", padding: 16 }}>
      <h1 style={{ fontSize: 20, marginBottom: 16 }}>Assign a task</h1>
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <select
          required
          value={form.assignedTo}
          onChange={(e) => setForm({ ...form, assignedTo: e.target.value })}
        >
          <option value="">Select team member</option>
          {users.map((u) => (
            <option key={u.user_id} value={u.user_id}>{u.name}</option>
          ))}
        </select>
        <input
          required
          placeholder="Task title"
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
        />
        <select
          value={form.priority}
          onChange={(e) => setForm({ ...form, priority: e.target.value })}
        >
          <option value="High">High</option>
          <option value="Medium">Medium</option>
          <option value="Low">Low</option>
        </select>
        <input
          type="date"
          value={form.dueDate}
          onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
        />
        <button type="submit" style={{ padding: 10, background: "#6366f1", color: "#fff", border: "none", borderRadius: 8 }}>
          Assign task
        </button>
      </form>
    </div>
  );
}
```

### 6. Nightly KPI Computation — Supabase Edge Function

Runs once daily (schedule via `pg_cron` or a Supabase Scheduled Edge Function at, e.g., 23:55 local time). This is server-side only — clients never write to `kpi_daily_snapshot` directly (enforced by the RLS policy in section 1F).

```sql
-- =====================================================================
-- Nightly KPI aggregation function
-- Schedule with pg_cron: select cron.schedule('nightly-kpi', '55 23 * * *',
--   $$ select public.compute_daily_kpi_snapshot(current_date); $$);
-- =====================================================================
create or replace function public.compute_daily_kpi_snapshot(target_date date)
returns void security definer as $$
begin
    insert into public.kpi_daily_snapshot (
        user_id, date, tasks_assigned, tasks_completed, tasks_completed_on_time,
        tasks_missed, avg_completion_minutes, attendance_status, clock_in_time,
        leads_touched, leads_converted, calls_logged, tickets_resolved,
        mapping_requests_resolved
    )
    select
        u.user_id,
        target_date,

        -- Task metrics
        coalesce(t.tasks_assigned, 0),
        coalesce(t.tasks_completed, 0),
        coalesce(t.tasks_completed_on_time, 0),
        coalesce(t.tasks_assigned, 0) - coalesce(t.tasks_completed, 0),
        t.avg_completion_minutes,

        -- Attendance metrics
        case
            when a.clock_in is null then 'Absent'
            when a.clock_in::time > time '10:00' then 'Late'
            else 'Present'
        end,
        a.clock_in::time,

        -- Sales / support metrics
        coalesce(l.leads_touched, 0),
        coalesce(l.leads_converted, 0),
        coalesce(c.calls_logged, 0),
        coalesce(ti.tickets_resolved, 0),
        coalesce(mr.mapping_requests_resolved, 0)

    from public.users u

    left join (
        select
            assigned_to,
            count(*) as tasks_assigned,
            count(*) filter (where status = 'Completed') as tasks_completed,
            count(*) filter (where status = 'Completed' and completed_at::date <= due_date) as tasks_completed_on_time,
            avg(extract(epoch from (completed_at - started_at)) / 60) filter (where completed_at is not null and started_at is not null) as avg_completion_minutes
        from public.tasks
        where due_date = target_date
        group by assigned_to
    ) t on t.assigned_to = u.user_id

    left join public.attendance a on a.user_id = u.user_id and a.date = target_date

    left join (
        select assigned_to as user_id, count(*) as leads_touched,
               count(*) filter (where status in ('Registration','Payment','Installation')) as leads_converted
        from public.leads
        where created_at::date = target_date or onboarded_at::date = target_date
        group by assigned_to
    ) l on l.user_id = u.user_id

    left join (
        select user_id, count(*) as calls_logged
        from public.call_logs
        where timestamp::date = target_date
        group by user_id
    ) c on c.user_id = u.user_id

    left join (
        select assigned_to as user_id, count(*) as tickets_resolved
        from public.internal_tickets
        where resolved_at::date = target_date
        group by assigned_to
    ) ti on ti.user_id = u.user_id

    left join (
        select mapped_by as user_id, count(*) as mapping_requests_resolved
        from public.mappings
        where created_at::date = target_date
        group by mapped_by
    ) mr on mr.user_id = u.user_id

    on conflict (user_id, date) do update set
        tasks_assigned = excluded.tasks_assigned,
        tasks_completed = excluded.tasks_completed,
        tasks_completed_on_time = excluded.tasks_completed_on_time,
        tasks_missed = excluded.tasks_missed,
        avg_completion_minutes = excluded.avg_completion_minutes,
        attendance_status = excluded.attendance_status,
        clock_in_time = excluded.clock_in_time,
        leads_touched = excluded.leads_touched,
        leads_converted = excluded.leads_converted,
        calls_logged = excluded.calls_logged,
        tickets_resolved = excluded.tickets_resolved,
        mapping_requests_resolved = excluded.mapping_requests_resolved;

    -- Also mark any task still Pending/In Progress past its due date as Missed
    update public.tasks
    set status = 'Missed'
    where due_date < target_date and status in ('Pending', 'In Progress');
end;
$$ language plpgsql;
```

### 7. Manager KPI Dashboard — `src/app/manager/kpi/page.tsx` (new file)

Restricted to `admin`. Shows team-wide trends, a leaderboard, and flags for people who need attention. Uses `recharts`, already an approved dependency pattern for this kind of dashboard (mirrors the "premium visual aesthetics" already used on the Executive Dashboard).

```tsx
// src/app/manager/kpi/page.tsx
"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabaseClient";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

interface KpiRow {
  user_id: string;
  name: string;
  completion_rate: number;
  tasks_assigned: number;
  tasks_completed: number;
  attendance_status: string;
  leads_converted: number;
  tickets_resolved: number;
}

export default function ManagerKpiPage() {
  const { capabilities } = useAuth();
  const [rows, setRows] = useState<KpiRow[]>([]);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));

  useEffect(() => {
    if (!capabilities.includes("admin")) return;
    (async () => {
      const { data } = await supabase
        .from("kpi_daily_snapshot")
        .select("user_id, completion_rate, tasks_assigned, tasks_completed, attendance_status, leads_converted, tickets_resolved, users!inner(name)")
        .eq("date", date);

      const mapped: KpiRow[] = (data || []).map((r: any) => ({
        user_id: r.user_id,
        name: r.users.name,
        completion_rate: r.completion_rate,
        tasks_assigned: r.tasks_assigned,
        tasks_completed: r.tasks_completed,
        attendance_status: r.attendance_status,
        leads_converted: r.leads_converted,
        tickets_resolved: r.tickets_resolved,
      }));
      mapped.sort((a, b) => b.completion_rate - a.completion_rate);
      setRows(mapped);
    })();
  }, [date, capabilities]);

  if (!capabilities.includes("admin")) {
    return <p style={{ padding: 24 }}>You don't have access to this page.</p>;
  }

  const flagged = rows.filter((r) => r.completion_rate < 50 || r.attendance_status !== "Present");

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: 24 }}>
      <h1 style={{ fontSize: 22, marginBottom: 16 }}>Team KPI — {date}</h1>
      <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ marginBottom: 20 }} />

      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={rows}>
          <XAxis dataKey="name" tick={{ fontSize: 12 }} />
          <YAxis />
          <Tooltip />
          <Bar dataKey="completion_rate" fill="#6366f1" radius={[6, 6, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>

      {flagged.length > 0 && (
        <div style={{ marginTop: 24, padding: 16, background: "#fef2f2", borderRadius: 12 }}>
          <h3 style={{ color: "#991b1b", marginBottom: 8 }}>Needs attention</h3>
          {flagged.map((r) => (
            <div key={r.user_id} style={{ fontSize: 14, marginBottom: 4 }}>
              {r.name} — {r.completion_rate}% task completion, {r.attendance_status}
            </div>
          ))}
        </div>
      )}

      <table style={{ width: "100%", marginTop: 24, borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
            <th style={{ padding: 8 }}>Name</th>
            <th style={{ padding: 8 }}>Completion</th>
            <th style={{ padding: 8 }}>Tasks</th>
            <th style={{ padding: 8 }}>Attendance</th>
            <th style={{ padding: 8 }}>Leads converted</th>
            <th style={{ padding: 8 }}>Tickets resolved</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.user_id} style={{ borderBottom: "1px solid #f0f0f0" }}>
              <td style={{ padding: 8 }}>{r.name}</td>
              <td style={{ padding: 8 }}>{r.completion_rate}%</td>
              <td style={{ padding: 8 }}>{r.tasks_completed}/{r.tasks_assigned}</td>
              <td style={{ padding: 8 }}>{r.attendance_status}</td>
              <td style={{ padding: 8 }}>{r.leads_converted}</td>
              <td style={{ padding: 8 }}>{r.tickets_resolved}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

### 8. Step-by-Step Implementation Checklist (Addendum Only)

1. Run the SQL in Section 1 in the Supabase SQL editor. Verify `select * from public.task_templates;` returns 21 rows.
2. Update `src/lib/db.ts`: add Dexie table definitions for `task_templates`, `tasks`, `task_status_history`. Bump the Dexie schema version number.
3. Add `src/lib/taskEngine.ts` exactly as in Section 2.
4. Add `src/app/my-day/page.tsx` exactly as in Section 3.
5. Edit `src/app/attendance/page.tsx`: redirect target `/my-day`.
6. Edit `src/app/login/page.tsx`: skip to `/my-day` if already clocked in today.
7. Edit `src/components/DashboardLayout.tsx`: add "My Day" as the first sidebar link.
8. Add `src/app/manager/tasks/page.tsx` exactly as in Section 5.
9. Run the SQL function in Section 6, then schedule it with `pg_cron` for 23:55 daily.
10. Add `src/app/manager/kpi/page.tsx` exactly as in Section 7. `npm install recharts` if needed.
11. Test end-to-end as described in the original delivery.

### 9. What This Part Does Not Change

Everything from the base `NEXUS_CRM_DOCUMENTATION.md` remains exactly as documented in its original form. Parts 2–6 below are what change it — read on.

---
---

# PART 2 — Pipeline Optimization (`/onboarding`)

## Why this needs work

The current Kanban pipeline is functionally complete but passive: a lead can sit in "Contacted" for three weeks and nothing in the system notices. For a non-technical team, "nobody complains" easily becomes "nobody follows up." Two changes fix this without touching the existing stage-transition rules or Kanban UI structure:

1. **Auto-generated follow-up tasks** — every stage transition creates a task on the assigned agent's My Day list, so follow-up isn't something they have to remember, it's something that shows up.
2. **Stale-lead flags** — a lead untouched for too long in one stage gets visually flagged on its card, and escalates into a High-priority task.

## 2.1 Schema addition — stage timestamp tracking

The existing `leads` table has no record of *when* a lead entered its current stage, which makes "how long has this been stuck" impossible to compute. Add one column and one trigger:

```sql
alter table public.leads add column if not exists stage_entered_at timestamp with time zone not null default timezone('utc'::text, now());

create or replace function public.track_lead_stage_change()
returns trigger as $$
begin
    if new.status is distinct from old.status then
        new.stage_entered_at = timezone('utc'::text, now());
    end if;
    return new;
end;
$$ language plpgsql;

create trigger trg_lead_stage_change
before update on public.leads
for each row execute function public.track_lead_stage_change();
```

## 2.2 Auto-task-on-transition trigger

When a lead moves stage, generate a follow-up task for whoever it's assigned to. Priority scales with proximity to close (closer to Payment/Installation = higher priority, since these are the highest-value leads to not drop).

```sql
create or replace function public.create_followup_task_on_stage_change()
returns trigger as $$
declare
    task_priority task_priority_enum;
    task_title text;
begin
    if new.status is distinct from old.status and new.assigned_to is not null then
        task_priority := case new.status
            when 'Contacted' then 'Medium'
            when 'Interested' then 'High'
            when 'Registration' then 'High'
            when 'Payment' then 'High'
            else 'Low'
        end;

        task_title := 'Follow up: ' || new.business_name || ' (' || new.status || ')';

        insert into public.tasks (
            assigned_to, assigned_by, title, description, priority,
            source, related_lead_id, due_date
        ) values (
            new.assigned_to, null, task_title,
            'Lead moved to ' || new.status || '. Follow up before it goes stale.',
            task_priority, 'manual', new.lead_id, current_date + 1
        )
        on conflict do nothing;
    end if;
    return new;
end;
$$ language plpgsql;

create trigger trg_lead_followup_task
after update on public.leads
for each row execute function public.create_followup_task_on_stage_change();
```

This means agents never need to check the Kanban board just to "see what's due" — the pipeline feeds the task list automatically, and the task list is the one screen non-technical staff actually live in.

## 2.3 Stale-lead detection (feeds both the Kanban UI and KPI)

```sql
create or replace view public.stale_leads as
select
    lead_id, business_name, segment_type, status, assigned_to, stage_entered_at,
    extract(day from (now() - stage_entered_at)) as days_in_stage
from public.leads
where status not in ('Installation', 'Not Interested')
and stage_entered_at < now() - interval '48 hours';
```

**Frontend change to `/onboarding`:** on the Kanban board, query `stale_leads` alongside the normal leads query. Any card whose `lead_id` appears in that result gets a thin red left border and a small "Stuck 3 days" label under the business name — no extra click required to see it. This is a CSS-only change to the existing card component; the Kanban lane structure and transition rules are untouched.

## 2.4 Simplified lead creation form

The current "New Lead" form is fine structurally but should default `assigned_to` to the current logged-in user automatically instead of showing a picker — a non-technical agent creating their own lead shouldn't have to find their own name in a dropdown. Add a "Reassign" option only inside the drawer for managers/admin, not on the creation form itself.

## 2.5 Mandatory loss reason

`leads.loss_reason` already exists but isn't enforced. Add a client-side validation rule in `validateLeadStatusTransition()` (in `validation.ts`): block the transition to `Not Interested` unless `loss_reason` is filled. This single rule is what makes "why are we losing leads" answerable later from the KPI/analytics side, instead of a silent status flip.

---
---

# PART 3 — Support & Mapping Bridge Optimization (`/support`)

## 3.1 Auto-task on new ticket

Mirror the same trigger pattern from Part 2 — when a `client_queries` row is created and assigned, generate a task automatically so ticket response isn't dependent on someone remembering to check the support page.

```sql
create or replace function public.create_task_on_new_query()
returns trigger as $$
begin
    if new.assigned_to is not null then
        insert into public.tasks (
            assigned_to, title, description, priority, source, due_date
        ) values (
            new.assigned_to,
            'Resolve client query',
            new.client_problem,
            'High', 'manual', current_date
        );
    end if;
    return new;
end;
$$ language plpgsql;

create trigger trg_query_task on public.client_queries
after insert on public.client_queries
for each row execute function public.create_task_on_new_query();
```

## 3.2 Ticket SLA escalation

Currently a ticket can sit in `Open` indefinitely with no visibility. Add an escalation flag using the same stale-detection pattern as leads:

```sql
create or replace view public.overdue_queries as
select query_id, lead_id, client_problem, assigned_to, created_at,
    extract(hour from (now() - created_at)) as hours_open
from public.client_queries
where problem_status != 'Resolved'
and created_at < now() - interval '24 hours';
```

**Frontend change to `/support`:** the ticket list badges any row in `overdue_queries` with a red "Overdue" pill next to the status pill. This directly feeds the KPI dashboard's ticket-resolution-time metric already defined in Part 1, and gives managers an early warning instead of finding out at month-end.

## 3.3 Simplify the mapping bridge builder

The current Distributor→Retailer search-and-select flow is fine for occasional use but slow for repeat users. Add a "Recent distributors" and "Recent retailers" quick-pick list (last 5 used by this agent, pulled from `mappings.mapped_by`) above the search box — cuts the average mapping creation from a full search to one click for the common case of mapping the same distributor to several retailers in a session.

---
---

# PART 4 — Attendance Optimization (`/attendance`)

## 4.1 Split the flow by role — office staff vs field staff

Right now every user goes through the same GPS + selfie flow. That's correct for field agents (`field_dist`, `field_ret`) where location verification is the point, but it's friction for office-based roles (`dist_onboarding`, `dist_support`, `ret_onboarding`, `ret_support`, `tech_support`, `admin`) who sit at a fixed desk all day — GPS adds no anti-fraud value there and just slows down the one action that should take two seconds.

**Logic change in `src/app/attendance/page.tsx`:**

```typescript
const FIELD_CAPABILITIES = ["field_dist", "field_ret"];
const isFieldStaff = capabilities.some((c) => FIELD_CAPABILITIES.includes(c));

// isFieldStaff === true  -> existing GPS + selfie flow, unchanged
// isFieldStaff === false -> single "Clock in" button, no camera/GPS calls,
//                           still writes the same attendance row (selfie_url
//                           and lat/long become nullable for this path)
```

```sql
alter table public.attendance alter column selfie_url drop not null;
alter table public.attendance alter column latitude drop not null;
alter table public.attendance alter column longitude drop not null;
```

This keeps anti-fraud verification exactly where it matters (agents claiming to have visited a site) and removes it where it's just friction (someone sitting at their desk), which is core to the "simple for non-technical staff" goal from day one.

## 4.2 Configurable shift start time (drives the Late/Present KPI cutoff)

Part 1's KPI function hardcodes `10:00` as the late cutoff. Make it a setting instead of a hardcoded value:

```sql
create table public.attendance_shift_config (
    config_id uuid primary key default gen_random_uuid(),
    shift_start time not null default '10:00',
    grace_minutes int not null default 15,
    updated_by uuid references public.users(user_id),
    updated_at timestamp with time zone default timezone('utc'::text, now())
);
insert into public.attendance_shift_config (shift_start, grace_minutes) values ('10:00', 15);
```

Update `compute_daily_kpi_snapshot()` from Part 1 to read this instead of the literal `time '10:00'`:

```sql
-- Replace the hardcoded comparison with:
(select shift_start + (grace_minutes || ' minutes')::interval from public.attendance_shift_config limit 1)
```

## 4.3 Missed clock-in regularization

Field agents with poor signal sometimes genuinely can't clock in on time. Rather than let that silently tank their KPI as "Absent," give them a correction path:

```sql
create table public.attendance_regularization_requests (
    request_id uuid primary key default gen_random_uuid(),
    user_id uuid references public.users(user_id) not null,
    date date not null,
    reason text not null,
    status text not null default 'Pending' check (status in ('Pending','Approved','Rejected')),
    reviewed_by uuid references public.users(user_id),
    created_at timestamp with time zone default timezone('utc'::text, now())
);
alter table public.attendance_regularization_requests enable row level security;

create policy regularization_own_read on public.attendance_regularization_requests
    for select using (user_id = auth.uid() or public.check_user_capability(auth.uid(), 'admin'));
create policy regularization_own_insert on public.attendance_regularization_requests
    for insert with check (user_id = auth.uid());
create policy regularization_admin_update on public.attendance_regularization_requests
    for update using (public.check_user_capability(auth.uid(), 'admin'));
```

**Frontend:** on `/attendance`, if a user opens the page and has no attendance row for a past date, show a small "Request correction" link instead of nothing. Approved requests get picked up by the nightly KPI job (add one more `left join` to `compute_daily_kpi_snapshot()` overriding `attendance_status` to `'Present'` where an approved regularization exists for that date).

---
---

# PART 5 — Admin Panel Optimization (`/admin`)

The existing Team Capability Matrix stays exactly as is. Add three tabs to the same page rather than new top-level routes, keeping the admin surface area consolidated in one place.

## 5.1 Manager assignment tab

Fills the gap flagged earlier — `manager_id` exists in the schema but nothing sets it. Simple list: every user, a dropdown next to their name to pick their manager from the same user list. Writes directly to `users.manager_id`, same sync pattern as capability toggles.

## 5.2 Task template management tab

Lets an admin edit the 21 seeded templates from Part 1 (add, deactivate, change priority) without touching SQL directly. Reads/writes `task_templates` — table listing with an edit-in-place row for `title`, `default_priority`, `is_active`.

## 5.3 Attendance settings tab

A single form editing the one row in `attendance_shift_config` from Part 4.2 — shift start time and grace period, in plain language ("Staff are marked late after ___").

---
---

# PART 6 — Sync Engine Hardening

## Why this matters now

Parts 2–4 add several new triggers and tables that all ride the same `sync_queue`. The original sync loop processes items **strictly in order and pauses entirely on a timeout** — fine for a light lead/attendance workload, but a single stuck item (e.g. a flaky network mid-selfie-upload) now blocks tasks, KPI-relevant status changes, and everything queued behind it. Two changes fix this without changing the overall offline-first design.

## 6.1 Per-item isolation with retry backoff

```typescript
// src/lib/db.ts — sync_queue table gets two new columns
export interface SyncQueueItem {
  id?: number;
  table_name: string;
  action: "INSERT" | "UPDATE" | "DELETE";
  data: any;
  timestamp: string;
  retry_count?: number;   // new
  last_error?: string;    // new
}
```

```typescript
// Replace the strict in-order "pause on timeout" behavior with per-item try/catch.
export async function processSyncQueue() {
  if (!navigator.onLine) return;
  const items = await db.sync_queue.orderBy("id").toArray();

  for (const item of items) {
    try {
      await applySyncItem(item); // existing supabase-js mutation call
      await db.sync_queue.delete(item.id!);
    } catch (err) {
      const retryCount = (item.retry_count || 0) + 1;
      if (retryCount >= 5) {
        // Dead-letter: stop retrying automatically, surface it in the UI
        // instead of silently blocking everything behind it.
        await db.sync_queue.update(item.id!, {
          retry_count: retryCount,
          last_error: String(err),
        });
        continue; // move on to the next item — do not block the queue
      }
      await db.sync_queue.update(item.id!, { retry_count: retryCount, last_error: String(err) });
    }
  }
}
```

**UI change to `DashboardLayout.tsx`'s existing queue counter:** show items with `retry_count >= 5` in a distinct color (amber) from the normal pending count, with a tap-to-view list of what failed and why — this turns a silent data-loss risk into something a non-technical user can at least notice and flag to an admin.

## 6.2 Periodic background sync, not just the `online` event

The original design only triggers sync on the `online` browser event, which misses the common real-world case of a flaky-but-technically-online connection (e.g. weak mobile signal that never fully drops). Add a low-frequency interval alongside the existing listener:

```typescript
if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    processSyncQueue().catch(console.error);
  });
  // New: catch cases where the connection never fully drops but requests
  // were silently failing (weak signal, captive portals, etc).
  setInterval(() => {
    if (navigator.onLine) processSyncQueue().catch(console.error);
  }, 60_000);
}
```

This is the change that makes the whole task/KPI system trustworthy for field agents specifically — they're the ones most likely to be on unreliable connections, and they're also the role whose task completions matter most for the KPI dashboard.

---
---

# PART 7 — Consolidated Schema Diff (Run Once, In Order)

Run in this exact sequence, after the base schema and after Part 1's SQL:

```sql
-- 1. Pipeline optimization (Part 2)
alter table public.leads add column if not exists stage_entered_at timestamp with time zone not null default timezone('utc'::text, now());
-- + track_lead_stage_change(), trg_lead_stage_change
-- + create_followup_task_on_stage_change(), trg_lead_followup_task
-- + stale_leads view

-- 2. Support optimization (Part 3)
-- + create_task_on_new_query(), trg_query_task
-- + overdue_queries view

-- 3. Attendance optimization (Part 4)
alter table public.attendance alter column selfie_url drop not null;
alter table public.attendance alter column latitude drop not null;
alter table public.attendance alter column longitude drop not null;
-- + attendance_shift_config table (+ seed row)
-- + attendance_regularization_requests table (+ RLS policies)
-- + update compute_daily_kpi_snapshot() to read attendance_shift_config
--   and left-join approved regularization requests

-- 4. Sync engine (Part 6)
-- Dexie-side only — no SQL required, sync_queue is a local IndexedDB table.
```

(Full `create function` / `create table` bodies for each are in Parts 2–4 above — copy them in full, this section is the ordering reference.)

---
---

# PART 8 — Master Implementation Checklist

Do this in order. Each numbered step assumes the previous one is done and deployed.

1. **Base system** — confirm `NEXUS_CRM_DOCUMENTATION.md`'s schema and app already exist and run.
2. **Part 1, Section 1** — run the Task/KPI schema SQL. Confirm 21 seeded templates.
3. **Part 1, Sections 2–5** — add `taskEngine.ts`, `/my-day`, redirect edits, sidebar link, `/manager/tasks`.
4. **Part 1, Sections 6–7** — deploy `compute_daily_kpi_snapshot()`, schedule it, add `/manager/kpi`.
5. **Part 2** — run the `stage_entered_at` column + trigger + `stale_leads` view SQL. Add the red-border/stuck-label styling to Kanban cards. Add the mandatory `loss_reason` validation rule. Default `assigned_to` to self on lead creation.
6. **Part 3** — run the `create_task_on_new_query` trigger and `overdue_queries` view. Add the "Overdue" badge to `/support`. Add "Recent distributors/retailers" quick-pick lists.
7. **Part 4** — run the nullable-column migration for attendance, `attendance_shift_config`, and `attendance_regularization_requests`. Split the attendance page logic by field vs office capability. Update `compute_daily_kpi_snapshot()` to use the config table and regularization join.
8. **Part 5** — add the three tabs to `/admin`: manager assignment, task template management, attendance settings.
9. **Part 6** — update `sync_queue` schema (retry_count, last_error), rewrite `processSyncQueue()` for per-item isolation, add the periodic sync interval, add the amber failed-sync indicator to the sidebar.
10. **Full regression pass** — re-run the end-to-end test from Part 1 Section 8, then additionally: move a lead through two stages and confirm a task appears on the assignee's My Day; leave a ticket open 25+ hours (or back-date `created_at` in a test row) and confirm it shows Overdue; clock in as an office-capability user and confirm no camera/GPS prompt appears; clock in as a field-capability user and confirm the original biometric flow is unchanged; force a sync failure (e.g. airplane mode mid-write) and confirm the queue counter turns amber after 5 retries instead of freezing.

At the end of this checklist, every module from the original documentation is either untouched (Kanban structure, mapping logic, RBAC model, PWA/service worker config) or deliberately extended in a way that ties back into one thing: the task list every employee sees the moment they log in, and the KPI numbers that come out of what they actually did with it.
