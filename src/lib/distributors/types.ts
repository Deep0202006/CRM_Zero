import type { RenewalState } from "./domain";

export type MappingStatus = "pending" | "done" | null;

export interface DistributorStatusRow {
  distributor_id: string;
  distributor_name: string;
  distributor_reference: string | null;
  lead_id: string | null;
  phone: string | null;
  city: string | null;
  assigned_to: string;
  assigned_employee_name: string;
  installation_status: "pending" | "done";
  installation_completed_at: string | null;
  training_status: "pending" | "done";
  training_completed_at: string | null;
  mapping_status: MappingStatus;
  mapped_at: string | null;
  activity_status: "not_applicable" | "active" | "inactive";
  billing_status: "not_billed" | "billed";
  billed_at: string | null;
  bill_reference: string | null;
  renewal_date: string | null;
  renewal_state: RenewalState;
  version: number;
  updated_at: string;
}

export interface DistributorMetrics {
  total: number;
  installation_pending: number;
  training_pending: number;
  installation_training_done: number;
  mapped: number;
  active: number;
  inactive: number;
  billed: number;
}

export type RenewalFilter = "all" | "overdue" | "today" | "tomorrow" | "in_two_days" | "upcoming" | "not_set";

export interface RenewalMetrics {
  overdue: number;
  today: number;
  tomorrow: number;
  in_two_days: number;
}

export interface RenewalListRow {
  distributor_id: string;
  distributor_name: string;
  assigned_to: string;
  assigned_employee_name: string;
  renewal_date: string | null;
  renewal_state: RenewalState;
  version: number;
  updated_at: string;
}
