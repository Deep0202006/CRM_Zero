// src/lib/teamKpi/contract.ts
export interface TeamKpiRow {
  user_id: string;
  name: string;
  role: string;
  tasks_assigned: number;
  tasks_completed: number;
  completion_rate: number;
  calls_made: number;
  mappings_completed: number;
  queries_handled: number;
  leads_converted: number;
  total_completed_work: number;
  attendance_status: string;
  latest_activity_time: string | null;
}
