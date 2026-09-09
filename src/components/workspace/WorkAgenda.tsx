"use client";

import type { LocalTask } from "@/lib/taskEngine";
import { Button } from "@/components/ui/Button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/Tabs";
import { EmptyState } from "@/components/ui/EmptyState";

export const AGENDA_VIEWS = ["Overdue", "Today", "Later", "Done"] as const;
export type AgendaView = typeof AGENDA_VIEWS[number];
export function taskAgendaView(task: Pick<LocalTask, "due_date" | "status">, today: string): AgendaView {
  if (task.status === "Completed") return "Done";
  return task.due_date < today ? "Overdue" : task.due_date > today ? "Later" : "Today";
}

export function WorkAgenda({ tasks, today, view, onView, selectedId, onSelect, onComplete, onDelete, canDelete, markingId }: {
  tasks: LocalTask[]; today: string; view: AgendaView; onView: (view: AgendaView) => void;
  selectedId: string | null; onSelect: (task: LocalTask, trigger: HTMLButtonElement) => void;
  onComplete: (task: LocalTask) => void; onDelete: (task: LocalTask) => void;
  canDelete: (task: LocalTask) => boolean; markingId: string | null;
}) {
  return <section className="workspace-register" data-workspace-register tabIndex={-1} aria-label="Work agenda">
    <Tabs value={view} onValueChange={(value) => onView(value as AgendaView)}>
      <TabsList aria-label="Task due views" className="flex w-full justify-start overflow-x-auto">
        {AGENDA_VIEWS.map((mode) => <TabsTrigger key={mode} value={mode}>{mode} <span className="tabular-nums">{tasks.filter((task) => taskAgendaView(task, today) === mode).length}</span></TabsTrigger>)}
      </TabsList>
      {AGENDA_VIEWS.map((mode) => { const rows = tasks.filter((task) => taskAgendaView(task, today) === mode); return <TabsContent key={mode} value={mode}>
        {rows.length ? <ol className="divide-y divide-[var(--border-subtle)]">{rows.map((task) => <li key={task.task_id} className="workspace-task-row" data-selected={task.task_id === selectedId}>
          <div className="min-w-0 flex-1"><button type="button" aria-pressed={task.task_id === selectedId} onClick={(event) => onSelect(task, event.currentTarget)} className="min-h-11 text-left text-sm font-semibold">{task.title}</button>
            <p className="text-xs text-[var(--text-secondary)]">{mode === "Done" ? "Completed" : mode === "Overdue" ? "Overdue" : mode === "Today" ? "Due today" : "Scheduled later"} · Due {task.due_date}{task.status === "In Progress" ? " · In progress" : ""}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {(task.status === "Pending" || task.status === "In Progress") && <Button size="sm" onClick={() => onComplete(task)} isLoading={markingId === task.task_id}>Done ✓</Button>}
            {(task.status === "Pending" || task.status === "In Progress") && canDelete(task) && <Button size="sm" variant="ghost" aria-label={`Delete ${task.title}`} disabled={Boolean(markingId)} onClick={() => onDelete(task)}>Delete</Button>}
          </div>
        </li>)}</ol> : <EmptyState title={`No ${mode.toLowerCase()} tasks`} description={mode === "Later" ? "No active tasks have a future due date." : "Choose another view or refresh your assigned work."} />}
      </TabsContent>; })}
    </Tabs>
  </section>;
}
