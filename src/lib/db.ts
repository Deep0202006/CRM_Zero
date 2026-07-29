import Dexie, { type Table } from "dexie";
import { LeadSegment, LeadStatus } from "./validation";
import { supabase, isSupabaseConfigured } from "./supabaseClient";
import { prepareSyncPayload } from "./syncPayload";
import { cleanupLocalStorage } from "./storageCleanup";
import { DAY_MS, STORAGE_BUDGET } from "./storageBudget";

// ─────────────────────────────────────────────────────────────────────────────
// INTERFACES — base system
// ─────────────────────────────────────────────────────────────────────────────

export interface LocalUser {
  user_id: string;
  name: string;
  email: string;
  phone?: string | null;
  is_active: number;
  manager_id?: string | null; // added for KPI rollup hierarchy
  created_at: string;
}

export interface LocalCapability {
  code: string;
  label: string;
}

export interface LocalUserCapability {
  id: string;
  user_id: string;
  capability_code: string;
  assigned_by?: string;
  assigned_at: string;
}

export interface LocalLead {
  lead_id: string;
  business_name: string;
  contact_person: string;
  phone: string;
  segment_type: LeadSegment;
  status: LeadStatus;
  loss_reason?: string | null;
  assigned_to?: string | null;
  created_at: string;
  onboarded_at?: string | null;
  stage_entered_at?: string | null; // Part 2 — pipeline optimization
  lead_source?: string;
  lead_source_other?: string | null;
  area?: string;
  re_engage_after?: string | null;
  renewal_date?: string | null;
  renewal_reminder_sent?: boolean;
}

export interface LocalClientQuery {
  query_id: string;
  client_username: string;
  client_name: string;
  client_problem: string;
  problem_status: "Open" | "In Progress" | "Resolved";
  assigned_to?: string | null;
  created_at: string;
  resolved_at?: string | null;
  resolution_notes?: string | null;
  resolved_by?: string | null;
}

export interface LocalMapping {
  mapping_id: string;
  distributor_lead_id: string;
  retailer_lead_id: string;
  requested_by: string;
  mapped_by?: string | null;
  notes?: string | null;
  created_at: string;
  request_source: string;
  completion_timestamp: string;
}

export interface LocalMappingRequest {
  request_id: string;
  distributor_lead_id: string;
  retailer_lead_id: string;
  requested_by?: string | null;
  mapped_by?: string | null;
  status: "Pending" | "Completed";
  notes?: string | null;
  created_at: string;
  completed_at?: string | null;
}

export interface LocalInternalTicket {
  ticket_id: string;
  raised_by: string;
  category: "Access" | "Bug" | "Data" | "Other";
  priority: "Low" | "Medium" | "High";
  status: "Open" | "In Progress" | "Resolved";
  description: string;
  assigned_to?: string | null;
  created_at: string;
  resolved_at?: string | null;
  resolution_notes?: string | null;
}

export interface LocalAttendance {
  attendance_id: string;
  user_id: string;
  date: string; // YYYY-MM-DD
  clock_in: string;
  clock_out?: string | null;
  selfie_url?: string | null; // now nullable — office staff skip selfie
  latitude?: number | null;   // now nullable — office staff skip GPS
  longitude?: number | null;
}

export interface LocalCallLog {
  log_id: string;
  user_id?: string | null;
  lead_id: string | null;
  client_username?: string | null;
  client_name?: string | null;
  timestamp: string;
  outcome: string;
  notes?: string | null;
  next_followup_date?: string | null;
}

export interface LocalRegistrationChecklist {
  checklist_id: string;
  lead_id: string;
  gst_certificate_uploaded: boolean;
  pan_uploaded: boolean;
  drug_licence_uploaded: boolean;
  bill_photo_uploaded: boolean;
  territory_assigned?: string | null;
  updated_at: string;
}

export interface LocalInstallationDetails {
  installation_id: string;
  lead_id: string;
  installed_by?: string | null;
  installation_date?: string | null;
  software_version?: string | null;
  staff_trained_count: number;
  issues_encountered?: string | null;
  proof_photo_url?: string | null;
  created_at: string;
}

export interface LocalPaymentDetails {
  payment_id: string;
  lead_id: string;
  amount: number;
  payment_mode?: string | null;
  receipt_url?: string | null;
  collected_by?: string | null;
  paid_at: string;
}

export interface LocalFieldVisit {
  visit_id: string;
  lead_id: string;
  user_id: string;
  visit_date: string;
  check_in_time: string;
  check_in_lat: number | null;
  check_in_lng: number | null;
  location_accuracy_m?: number | null;
  location_captured_at?: string | null;
  location_acquisition_mode?: string | null;
  location_quality?: string | null;
  check_in_photo_url: string | null;
  selfie_captured_at?: string | null;
  selfie_capture_method?: string | null;
  selfie_storage_path?: string | null;
  visit_outcome: string;
  visit_notes: string | null;
  attendance_id?: string | null;
  person_met?: string | null;
  segment_type?: string | null;
  follow_up_date?: string | null;
  sync_status?: 'pending_sync' | 'synced' | 'sync_failed';
  created_at: string;
  updated_at: string;
}

export interface LocalFieldVisitMedia {
  media_id: string;
  visit_id: string;
  user_id: string;
  media_data: Blob;
  created_at: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// INTERFACES — Task & KPI addendum (Part 1)
// ─────────────────────────────────────────────────────────────────────────────

export interface LocalTaskTemplate {
  template_id: string;
  title: string;
  description: string | null;
  applies_to_capability: string;
  default_priority: "High" | "Medium" | "Low";
  recurrence: string;
  is_active: number; // 0 | 1
  created_by?: string | null;
  created_at: string;
}

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

export interface LocalTaskStatusHistory {
  id: string;
  task_id: string;
  changed_by: string | null;
  old_status: string | null;
  new_status: string;
  changed_at: string;
}

export interface LocalKpiSnapshot {
  snapshot_id: string;
  user_id: string;
  date: string; // YYYY-MM-DD
  tasks_assigned: number;
  tasks_completed: number;
  tasks_completed_on_time: number;
  tasks_missed: number;
  completion_rate: number;
  avg_completion_minutes: number | null;
  attendance_status: string | null;
  clock_in_time: string | null;
  leads_touched: number;
  leads_converted: number;
  calls_logged: number;
  tickets_resolved: number;
  mapping_requests_resolved: number;
  created_at: string;
}

export interface LocalTaskUploadBatch {
  id: string;
  uploaded_by: string;
  filename: string;
  file_hash: string;
  created_at: string;
}

export interface LocalAllocatedTarget {
  target_id: string;
  batch_id: string;
  assigned_to_user_id: string;
  target_username: string;
  target_name: string;
  target_address?: string;
  target_area?: string;
  target_state?: string;
  target_mobile: string;
  target_email?: string;
  city: string;
  pspa_code?: string;
  third_party_code?: string;
  dlic1?: string;
  dlic2?: string;
  dlic3?: string;
  dlic4?: string;
  food_license?: string;
  is_completed: boolean | string | number;
  completed_at: string | null;
  created_at: string;
  // For sync tracking
  sync_status?: "synced" | "pending" | "error";
  last_synced_at?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// INTERFACES — Sync queue (Part 6 hardening)
// ─────────────────────────────────────────────────────────────────────────────

export interface SyncQueueItem {
  id?: number;
  operation_id?: string;
  idempotency_key: string;
  entity_type?: string;
  entity_id?: string;
  command_name?: string;
  command_args?: Record<string, unknown>;
  created_at?: string;
  original_occurred_at?: string;
  status?: "pending" | "syncing" | "retry_wait" | "permanent_failure";
  next_retry_at?: string | null;
  last_attempt_at?: string | null;
  last_error_code?: string | null;
  last_error_message?: string | null;
  confirmed_at?: string | null;
  table_name: string;
  action: "INSERT" | "UPDATE" | "DELETE";
  data: object;
  timestamp: string;
  retry_count?: number;  // Part 6 — per-item retry tracking
  last_error?: string;   // Part 6 — surfaces dead-letter failures in UI
}

// ─────────────────────────────────────────────────────────────────────────────
// DEXIE DATABASE CLASS
// ─────────────────────────────────────────────────────────────────────────────

class CRMDatabase extends Dexie {
  // Base tables
  users!: Table<LocalUser, string>;
  capabilities!: Table<LocalCapability, string>;
  user_capabilities!: Table<LocalUserCapability, string>;
  leads!: Table<LocalLead, string>;
  client_queries!: Table<LocalClientQuery, string>;
  mappings!: Table<LocalMapping, string>;
  mapping_requests!: Table<LocalMappingRequest, string>;
  internal_tickets!: Table<LocalInternalTicket, string>;
  attendance!: Table<LocalAttendance, string>;
  call_logs!: Table<LocalCallLog, string>;
  sync_queue!: Table<SyncQueueItem, number>;

  // Task & KPI tables (addendum)
  task_templates!: Table<LocalTaskTemplate, string>;
  tasks!: Table<LocalTask, string>;
  task_status_history!: Table<LocalTaskStatusHistory, string>;
  kpi_snapshots!: Table<LocalKpiSnapshot, string>;

  // Pipeline tables
  lead_registration_checklist!: Table<LocalRegistrationChecklist, string>;
  lead_installation_details!: Table<LocalInstallationDetails, string>;
  lead_payment_details!: Table<LocalPaymentDetails, string>;
  field_visits!: Table<LocalFieldVisit, string>;
  field_visit_media!: Table<LocalFieldVisitMedia, string>;

  // Task allocation (Excel uploads)
  task_upload_batches!: Table<LocalTaskUploadBatch, string>;
  allocated_targets!: Table<LocalAllocatedTarget, string>;

  constructor() {
    super("CRMDatabase");

    // Version 1 — original schema (must stay exactly as-is for migration)
    this.version(1).stores({
      users: "user_id, email, is_active",
      capabilities: "code",
      user_capabilities: "id, user_id, capability_code, [user_id+capability_code]",
      leads: "lead_id, business_name, segment_type, status, assigned_to",
      client_queries: "query_id, lead_id, problem_status, assigned_to",
      mappings: "mapping_id, distributor_lead_id, retailer_lead_id, [distributor_lead_id+retailer_lead_id], mapped_by",
      mapping_requests: "request_id, requester_id, assigned_to_id, status",
      internal_tickets: "ticket_id, raised_by, status, assigned_to",
      attendance: "attendance_id, user_id, date, [user_id+date]",
      call_logs: "log_id, user_id, lead_id, timestamp",
      sync_queue: "++id, table_name, action, timestamp",
    });

    // Version 2 — Task/KPI addendum + sync hardening
    this.version(2).stores({
      users: "user_id, email, is_active, manager_id",
      capabilities: "code",
      user_capabilities: "id, user_id, capability_code, [user_id+capability_code]",
      leads: "lead_id, business_name, segment_type, status, assigned_to, stage_entered_at",
      client_queries: "query_id, lead_id, problem_status, assigned_to",
      mappings: "mapping_id, distributor_lead_id, retailer_lead_id, [distributor_lead_id+retailer_lead_id], mapped_by",
      mapping_requests: "request_id, requester_id, assigned_to_id, status",
      internal_tickets: "ticket_id, raised_by, status, assigned_to",
      attendance: "attendance_id, user_id, date, [user_id+date]",
      call_logs: "log_id, user_id, lead_id, timestamp",
      sync_queue: "++id, table_name, action, timestamp, retry_count",
      // New tables
      task_templates: "template_id, applies_to_capability, is_active",
      tasks: "task_id, assigned_to, due_date, status, [assigned_to+due_date], template_id",
      task_status_history: "id, task_id, changed_at",
      kpi_snapshots: "snapshot_id, user_id, date, [user_id+date]",
    });

    // Version 3 — Pipeline optimization (schema + RLS)
    this.version(3).stores({
      users: "user_id, email, is_active, manager_id",
      capabilities: "code",
      user_capabilities: "id, user_id, capability_code, [user_id+capability_code]",
      leads: "lead_id, business_name, segment_type, status, assigned_to, stage_entered_at, lead_source, area",
      client_queries: "query_id, lead_id, problem_status, assigned_to",
      mappings: "mapping_id, distributor_lead_id, retailer_lead_id, [distributor_lead_id+retailer_lead_id], mapped_by",
      mapping_requests: "request_id, requester_id, assigned_to_id, status",
      internal_tickets: "ticket_id, raised_by, status, assigned_to",
      attendance: "attendance_id, user_id, date, [user_id+date]",
      call_logs: "log_id, user_id, lead_id, timestamp",
      sync_queue: "++id, table_name, action, timestamp, retry_count",
      task_templates: "template_id, applies_to_capability, is_active",
      tasks: "task_id, assigned_to, due_date, status, [assigned_to+due_date], template_id",
      task_status_history: "id, task_id, changed_at",
      kpi_snapshots: "snapshot_id, user_id, date, [user_id+date]",
      // New tables
      lead_registration_checklist: "checklist_id, lead_id",
      lead_installation_details: "installation_id, lead_id",
      lead_payment_details: "payment_id, lead_id",
    });

    // Version 4 — Renewal checklist and support resolution addendum
    this.version(4).stores({
      users: "user_id, email, is_active, manager_id",
      capabilities: "code",
      user_capabilities: "id, user_id, capability_code, [user_id+capability_code]",
      leads: "lead_id, business_name, segment_type, status, assigned_to, stage_entered_at, lead_source, area, renewal_date",
      client_queries: "query_id, lead_id, problem_status, assigned_to",
      mappings: "mapping_id, distributor_lead_id, retailer_lead_id, [distributor_lead_id+retailer_lead_id], mapped_by",
      mapping_requests: "request_id, requester_id, assigned_to_id, status",
      internal_tickets: "ticket_id, raised_by, status, assigned_to",
      attendance: "attendance_id, user_id, date, [user_id+date]",
      call_logs: "log_id, user_id, lead_id, timestamp",
      sync_queue: "++id, table_name, action, timestamp, retry_count",
      task_templates: "template_id, applies_to_capability, is_active",
      tasks: "task_id, assigned_to, due_date, status, [assigned_to+due_date], template_id",
      task_status_history: "id, task_id, changed_at",
      kpi_snapshots: "snapshot_id, user_id, date, [user_id+date]",
      lead_registration_checklist: "checklist_id, lead_id",
      lead_installation_details: "installation_id, lead_id",
      lead_payment_details: "payment_id, lead_id",
    });

    // Version 5 — Add idempotency_key to sync_queue and remove plaintext passwords
    this.version(5).stores({
      users: "user_id, email, is_active, manager_id",
      capabilities: "code",
      user_capabilities: "id, user_id, capability_code, [user_id+capability_code]",
      leads: "lead_id, business_name, segment_type, status, assigned_to, stage_entered_at, lead_source, area, renewal_date",
      client_queries: "query_id, lead_id, problem_status, assigned_to",
      mappings: "mapping_id, distributor_lead_id, retailer_lead_id, [distributor_lead_id+retailer_lead_id], mapped_by",
      mapping_requests: "request_id, requester_id, assigned_to_id, status",
      internal_tickets: "ticket_id, raised_by, status, assigned_to",
      attendance: "attendance_id, user_id, date, [user_id+date]",
      call_logs: "log_id, user_id, lead_id, timestamp",
      sync_queue: "++id, idempotency_key, table_name, action, timestamp, retry_count",
      task_templates: "template_id, applies_to_capability, is_active",
      tasks: "task_id, assigned_to, due_date, status, [assigned_to+due_date], template_id",
      task_status_history: "id, task_id, changed_at",
      kpi_snapshots: "snapshot_id, user_id, date, [user_id+date]",
      lead_registration_checklist: "checklist_id, lead_id",
      lead_installation_details: "installation_id, lead_id",
      lead_payment_details: "payment_id, lead_id",
    });

    // Version 6 — Update mapping_requests schema for simple tracking log
    this.version(6).stores({
      users: "user_id, email, is_active, manager_id",
      capabilities: "code",
      user_capabilities: "id, user_id, capability_code, [user_id+capability_code]",
      leads: "lead_id, business_name, segment_type, status, assigned_to, stage_entered_at, lead_source, area, renewal_date",
      client_queries: "query_id, lead_id, problem_status, assigned_to",
      mappings: "mapping_id, distributor_lead_id, retailer_lead_id, [distributor_lead_id+retailer_lead_id], mapped_by",
      mapping_requests: "request_id, distributor_lead_id, retailer_lead_id, mapped_by, status",
      internal_tickets: "ticket_id, raised_by, status, assigned_to",
      attendance: "attendance_id, user_id, date, [user_id+date]",
      call_logs: "log_id, user_id, lead_id, timestamp",
      sync_queue: "++id, idempotency_key, table_name, action, timestamp, retry_count",
      task_templates: "template_id, applies_to_capability, is_active",
      tasks: "task_id, assigned_to, due_date, status, [assigned_to+due_date], template_id",
      task_status_history: "id, task_id, changed_at",
      kpi_snapshots: "snapshot_id, user_id, date, [user_id+date]",
      lead_registration_checklist: "checklist_id, lead_id",
      lead_installation_details: "installation_id, lead_id",
      lead_payment_details: "payment_id, lead_id",
    });

    // Version 7 — Add created_at to indices for sorting in frontend queues
    this.version(7).stores({
      users: "user_id, email, is_active, manager_id",
      capabilities: "code",
      user_capabilities: "id, user_id, capability_code, [user_id+capability_code]",
      leads: "lead_id, business_name, segment_type, status, assigned_to, stage_entered_at, lead_source, area, renewal_date",
      client_queries: "query_id, lead_id, problem_status, assigned_to, created_at",
      mappings: "mapping_id, distributor_lead_id, retailer_lead_id, [distributor_lead_id+retailer_lead_id], mapped_by",
      mapping_requests: "request_id, distributor_lead_id, retailer_lead_id, mapped_by, status, created_at",
      internal_tickets: "ticket_id, raised_by, status, assigned_to",
      attendance: "attendance_id, user_id, date, [user_id+date]",
      call_logs: "log_id, user_id, lead_id, timestamp",
      sync_queue: "++id, idempotency_key, table_name, action, timestamp, retry_count",
      task_templates: "template_id, applies_to_capability, is_active",
      tasks: "task_id, assigned_to, due_date, status, [assigned_to+due_date], template_id",
      task_status_history: "id, task_id, changed_at",
      kpi_snapshots: "snapshot_id, user_id, date, [user_id+date]",
      lead_registration_checklist: "checklist_id, lead_id",
      lead_installation_details: "installation_id, lead_id",
      lead_payment_details: "payment_id, lead_id",
    });
    this.version(8).stores({
      users: "user_id, email, is_active, manager_id",
      capabilities: "code",
      user_capabilities: "id, user_id, capability_code, [user_id+capability_code]",
      leads: "lead_id, business_name, segment_type, status, assigned_to, stage_entered_at, lead_source, area, renewal_date",
      client_queries: "query_id, client_username, problem_status, assigned_to, created_at",
      mappings: "mapping_id, distributor_lead_id, retailer_lead_id, [distributor_lead_id+retailer_lead_id], mapped_by",
      mapping_requests: "request_id, distributor_lead_id, retailer_lead_id, mapped_by, status, created_at",
      internal_tickets: "ticket_id, raised_by, status, assigned_to",
      attendance: "attendance_id, user_id, date, [user_id+date]",
      call_logs: "log_id, user_id, lead_id, timestamp",
      sync_queue: "++id, idempotency_key, table_name, action, timestamp, retry_count",
      task_templates: "template_id, applies_to_capability, is_active",
      tasks: "task_id, assigned_to, due_date, status, [assigned_to+due_date], template_id",
      task_status_history: "id, task_id, changed_at",
      kpi_snapshots: "snapshot_id, user_id, date, [user_id+date]",
      lead_registration_checklist: "checklist_id, lead_id",
      lead_installation_details: "installation_id, lead_id",
      lead_payment_details: "payment_id, lead_id",
    });

    // Version 10 — Excel-based bulk task allocation with compound index
    this.version(10).stores({
      users: "user_id, email, is_active, manager_id",
      capabilities: "code",
      user_capabilities: "id, user_id, capability_code, [user_id+capability_code]",
      leads: "lead_id, business_name, segment_type, status, assigned_to, stage_entered_at, lead_source, area, renewal_date",
      client_queries: "query_id, client_username, problem_status, assigned_to, created_at",
      mappings: "mapping_id, distributor_lead_id, retailer_lead_id, [distributor_lead_id+retailer_lead_id], mapped_by",
      mapping_requests: "request_id, distributor_lead_id, retailer_lead_id, mapped_by, status, created_at",
      internal_tickets: "ticket_id, raised_by, status, assigned_to",
      attendance: "attendance_id, user_id, date, [user_id+date]",
      call_logs: "log_id, user_id, lead_id, timestamp",
      sync_queue: "++id, idempotency_key, table_name, action, timestamp, retry_count",
      task_templates: "template_id, applies_to_capability, is_active",
      tasks: "task_id, assigned_to, due_date, status, [assigned_to+due_date], template_id",
      task_status_history: "id, task_id, changed_at",
      kpi_snapshots: "snapshot_id, user_id, date, [user_id+date]",
      lead_registration_checklist: "checklist_id, lead_id",
      lead_installation_details: "installation_id, lead_id",
      lead_payment_details: "payment_id, lead_id",
      task_upload_batches: "id, uploaded_by, file_hash",
      allocated_targets: "target_id, batch_id, assigned_to_user_id, city, is_completed, [assigned_to_user_id+is_completed+city]",
    });
    // Version 11 — Add field visits
    this.version(11).stores({
      users: "user_id, email, is_active, manager_id",
      capabilities: "code",
      user_capabilities: "id, user_id, capability_code, [user_id+capability_code]",
      leads: "lead_id, business_name, segment_type, status, assigned_to, stage_entered_at, lead_source, area, renewal_date",
      client_queries: "query_id, client_username, problem_status, assigned_to, created_at",
      mappings: "mapping_id, distributor_lead_id, retailer_lead_id, [distributor_lead_id+retailer_lead_id], mapped_by",
      mapping_requests: "request_id, distributor_lead_id, retailer_lead_id, mapped_by, status, created_at",
      internal_tickets: "ticket_id, raised_by, status, assigned_to",
      attendance: "attendance_id, user_id, date, [user_id+date]",
      call_logs: "log_id, user_id, lead_id, timestamp",
      sync_queue: "++id, idempotency_key, table_name, action, timestamp, retry_count",
      task_templates: "template_id, applies_to_capability, is_active",
      tasks: "task_id, assigned_to, due_date, status, [assigned_to+due_date], template_id",
      task_status_history: "id, task_id, changed_at",
      kpi_snapshots: "snapshot_id, user_id, date, [user_id+date]",
      lead_registration_checklist: "checklist_id, lead_id",
      lead_installation_details: "installation_id, lead_id",
      lead_payment_details: "payment_id, lead_id",
      task_upload_batches: "id, uploaded_by, file_hash",
      allocated_targets: "target_id, batch_id, assigned_to_user_id, city, is_completed, [assigned_to_user_id+is_completed+city]",
      field_visits: "visit_id, lead_id, user_id, visit_date, [user_id+visit_date]",
    });
    // Version 12 — Add sync_status to field_visits index
    this.version(12).stores({
      users: "user_id, email, is_active, manager_id",
      capabilities: "code",
      user_capabilities: "id, user_id, capability_code, [user_id+capability_code]",
      leads: "lead_id, business_name, segment_type, status, assigned_to, stage_entered_at, lead_source, area, renewal_date",
      client_queries: "query_id, client_username, problem_status, assigned_to, created_at",
      mappings: "mapping_id, distributor_lead_id, retailer_lead_id, [distributor_lead_id+retailer_lead_id], mapped_by",
      mapping_requests: "request_id, distributor_lead_id, retailer_lead_id, mapped_by, status, created_at",
      internal_tickets: "ticket_id, raised_by, status, assigned_to",
      attendance: "attendance_id, user_id, date, [user_id+date]",
      call_logs: "log_id, user_id, lead_id, timestamp",
      sync_queue: "++id, idempotency_key, table_name, action, timestamp, retry_count",
      task_templates: "template_id, applies_to_capability, is_active",
      tasks: "task_id, assigned_to, due_date, status, [assigned_to+due_date], template_id",
      task_status_history: "id, task_id, changed_at",
      kpi_snapshots: "snapshot_id, user_id, date, [user_id+date]",
      lead_registration_checklist: "checklist_id, lead_id",
      lead_installation_details: "installation_id, lead_id",
      lead_payment_details: "payment_id, lead_id",
      task_upload_batches: "id, uploaded_by, file_hash",
      allocated_targets: "target_id, batch_id, assigned_to_user_id, city, is_completed, [assigned_to_user_id+is_completed+city]",
      field_visits: "visit_id, lead_id, user_id, visit_date, sync_status, [user_id+visit_date]",
    });

    // Version 13 — Field Visits Production Hardening
    this.version(13).stores({
      users: "user_id, email, is_active, manager_id",
      capabilities: "code",
      user_capabilities: "id, user_id, capability_code, [user_id+capability_code]",
      leads: "lead_id, business_name, segment_type, status, assigned_to, stage_entered_at, lead_source, area, renewal_date",
      client_queries: "query_id, client_username, problem_status, assigned_to, created_at",
      mappings: "mapping_id, distributor_lead_id, retailer_lead_id, [distributor_lead_id+retailer_lead_id], mapped_by",
      mapping_requests: "request_id, distributor_lead_id, retailer_lead_id, mapped_by, status, created_at",
      internal_tickets: "ticket_id, raised_by, status, assigned_to",
      attendance: "attendance_id, user_id, date, [user_id+date]",
      call_logs: "log_id, user_id, lead_id, timestamp",
      sync_queue: "++id, idempotency_key, table_name, action, timestamp, retry_count",
      task_templates: "template_id, applies_to_capability, is_active",
      tasks: "task_id, assigned_to, due_date, status, [assigned_to+due_date], template_id",
      task_status_history: "id, task_id, changed_at",
      kpi_snapshots: "snapshot_id, user_id, date, [user_id+date]",
      lead_registration_checklist: "checklist_id, lead_id",
      lead_installation_details: "installation_id, lead_id",
      lead_payment_details: "payment_id, lead_id",
      task_upload_batches: "id, uploaded_by, file_hash",
      allocated_targets: "target_id, batch_id, assigned_to_user_id, city, is_completed, [assigned_to_user_id+is_completed+city]",
      field_visits: "visit_id, lead_id, user_id, visit_date, sync_status, [user_id+visit_date]",
      field_visit_media: "media_id, visit_id, user_id"
    });
    // Version 14 — migrate legacy Base64 evidence to structured-clone Blobs.
    this.version(14).stores({
      field_visit_media: "media_id, visit_id, user_id"
    }).upgrade(async (transaction) => {
      const mediaTable = transaction.table("field_visit_media");
      const records = await mediaTable.toArray() as Record<string, unknown>[];
      for (const record of records) {
        if (typeof record.media_data === "string" && record.media_data.startsWith("data:")) {
          record.media_data = await (await fetch(record.media_data)).blob();
          await mediaTable.put(record);
        }
      }
    });
  }
}

export const db = new CRMDatabase();

// SEED DATA HAS BEEN REMOVED FOR PRODUCTION HARDENING

// ─────────────────────────────────────────────────────────────────────────────
// SYNC STREAM FILTER
// ─────────────────────────────────────────────────────────────────────────────

export function filterSyncStream<T extends { segment_type?: LeadSegment; lead_id?: string }>(
  items: T[],
  userCapabilities: string[],
  leadsLookup: Record<string, LocalLead>
): T[] {
  if (userCapabilities.includes("admin") || userCapabilities.includes("tech_support")) {
    return items;
  }

  const hasDist = userCapabilities.some((c) => ["dist_onboarding", "dist_support", "field_dist"].includes(c));
  const hasRet = userCapabilities.some((c) => ["ret_onboarding", "ret_support", "field_ret"].includes(c));

  return items.filter((item) => {
    if (item.segment_type) {
      if (item.segment_type === "Distributor" && hasDist) return true;
      if (item.segment_type === "Retailer" && hasRet) return true;
      return false;
    }
    if (item.lead_id && leadsLookup[item.lead_id]) {
      const seg = leadsLookup[item.lead_id].segment_type;
      if (seg === "Distributor" && hasDist) return true;
      if (seg === "Retailer" && hasRet) return true;
      return false;
    }
    return true;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// TABLE MAPPINGS — Remote (Supabase) to Local (Dexie)
// ─────────────────────────────────────────────────────────────────────────────

const REMOTE_TO_LOCAL_TABLE: Record<string, string> = {
  kpi_daily_snapshot: "kpi_snapshots",
  field_visits: "field_visits",
};

// ─────────────────────────────────────────────────────────────────────────────
// PRIMARY KEY LOOKUP — used by processSyncQueue UPDATE/DELETE
// ─────────────────────────────────────────────────────────────────────────────

const TABLE_PK: Record<string, string> = {
  users: "user_id",
  leads: "lead_id",
  client_queries: "query_id",
  mappings: "mapping_id",
  mapping_requests: "request_id",
  internal_tickets: "ticket_id",
  attendance: "attendance_id",
  call_logs: "log_id",
  tasks: "task_id",
  task_templates: "template_id",
  task_status_history: "id",
  kpi_snapshots: "snapshot_id", // fixed name
  lead_registration_checklist: "checklist_id",
  lead_installation_details: "installation_id",
  lead_payment_details: "payment_id",
  field_visits: "visit_id",
  capabilities: "code",
  user_capabilities: "id",
  task_upload_batches: "id",
  allocated_targets: "target_id",
  field_visit_media: "media_id",
};

// ─────────────────────────────────────────────────────────────────────────────
// OFFLINE QUEUE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

type DynamicRow = Record<string, unknown>;
type DynamicTable = Table<DynamicRow, unknown>;
const dynamicTables = db as unknown as Record<string, DynamicTable>;
const toDynamicRow = (value: object): DynamicRow => Object.fromEntries(Object.entries(value));
const getDynamicField = (value: object, key: string): unknown => toDynamicRow(value)[key];

const COMPLETED_VALUES = new Set(["completed", "resolved", "true", "1"]);

export function semanticOperationId(
  tableName: string,
  action: "INSERT" | "UPDATE" | "DELETE",
  data: object,
): string {
  const row = toDynamicRow(data);
  const primaryKey = TABLE_PK[tableName] ?? "id";
  const entityId = String(row[primaryKey] ?? "");
  if (!entityId) throw new Error(`Cannot queue ${tableName} without ${primaryKey}.`);

  if (tableName === "call_logs" && action === "INSERT") return `call:${entityId}`;
  if (tableName === "client_queries" && COMPLETED_VALUES.has(String(row.problem_status).toLowerCase())) {
    return `query-resolution:${entityId}`;
  }
  if (tableName === "mapping_requests" && COMPLETED_VALUES.has(String(row.status).toLowerCase())) {
    return `mapping-completion:${entityId}`;
  }
  if (tableName === "tasks" && COMPLETED_VALUES.has(String(row.status).toLowerCase())) {
    return `task-completion:${entityId}`;
  }
  if (tableName === "allocated_targets" && COMPLETED_VALUES.has(String(row.is_completed).toLowerCase())) {
    return `allocated-target-completion:${entityId}`;
  }
  if (tableName === "field_visits" && action === "INSERT") return `field-visit:${entityId}`;
  return `${tableName}:${action.toLowerCase()}:${entityId}`;
}

export function buildQueueItem(
  tableName: string,
  action: "INSERT" | "UPDATE" | "DELETE",
  data: object,
): SyncQueueItem {
  const now = new Date().toISOString();
  const row = toDynamicRow(data);
  const primaryKey = TABLE_PK[tableName] ?? "id";
  const entityId = String(row[primaryKey]);
  const idempotencyKey = semanticOperationId(tableName, action, data);
  const operationId = crypto.randomUUID();
  const occurredAt = String(
    row.timestamp ?? row.resolved_at ?? row.completed_at ?? row.check_in_time ?? row.created_at ?? now,
  );
  let commandName = "verified_crud";
  let commandArgs: Record<string, unknown> = row;
  if (tableName === "call_logs" && action === "INSERT") {
    commandName = "log_call_v1";
    commandArgs = {
      p_log_id: row.log_id, p_lead_id: row.lead_id ?? null,
      p_client_username: row.client_username ?? null, p_client_name: row.client_name ?? null,
      p_occurred_at: occurredAt, p_outcome: row.outcome, p_notes: row.notes ?? null,
      p_next_followup_date: row.next_followup_date ?? null,
    };
  } else if (tableName === "client_queries" && idempotencyKey.startsWith("query-resolution:")) {
    commandName = "resolve_client_query_v1";
    commandArgs = { p_query_id: row.query_id, p_occurred_at: occurredAt, p_resolution_notes: row.resolution_notes ?? null };
  } else if (tableName === "mapping_requests" && idempotencyKey.startsWith("mapping-completion:")) {
    commandName = "complete_mapping_v1";
    commandArgs = { p_request_id: row.request_id, p_occurred_at: occurredAt };
  } else if (tableName === "tasks" && idempotencyKey.startsWith("task-completion:")) {
    commandName = "complete_task_v1";
    commandArgs = { p_task_id: row.task_id, p_occurred_at: occurredAt };
  } else if (tableName === "allocated_targets" && idempotencyKey.startsWith("allocated-target-completion:")) {
    commandName = "complete_allocated_target_v1";
    commandArgs = { p_target_id: row.target_id, p_occurred_at: occurredAt };
  } else if (tableName === "field_visits" && action === "INSERT") {
    commandName = "create_field_visit_v1";
    commandArgs = {
      p_visit_id: row.visit_id, p_lead_id: row.lead_id, p_visit_date: row.visit_date,
      p_check_in_time: row.check_in_time, p_lat: row.check_in_lat, p_lng: row.check_in_lng,
      p_accuracy: row.location_accuracy_m, p_location_captured_at: row.location_captured_at,
      p_location_mode: row.location_acquisition_mode, p_location_quality: row.location_quality,
      p_selfie_captured_at: row.selfie_captured_at, p_selfie_method: row.selfie_capture_method,
      p_selfie_path: row.selfie_storage_path, p_outcome: row.visit_outcome,
      p_notes: row.visit_notes ?? null, p_attendance_id: row.attendance_id,
      p_person_met: row.person_met ?? null, p_segment: row.segment_type,
      p_follow_up_date: row.follow_up_date ?? null,
    };
  }
  return {
    operation_id: operationId,
    idempotency_key: idempotencyKey,
    entity_type: tableName,
    entity_id: entityId,
    command_name: commandName,
    command_args: commandArgs,
    created_at: now,
    original_occurred_at: occurredAt,
    status: "pending",
    next_retry_at: null,
    table_name: tableName,
    action,
    data,
    timestamp: now,
    retry_count: 0,
  };
}

export async function transactionalMutation(
  tableName: string,
  action: "INSERT" | "UPDATE" | "DELETE",
  data: object
) {
  const table = dynamicTables[tableName];
  await db.transaction('rw', [table, db.sync_queue], async () => {
    if (action === "INSERT") {
      await table.add(toDynamicRow(data));
    } else if (action === "UPDATE") {
      const pk = TABLE_PK[tableName] ?? "id";
      await table.update(getDynamicField(data, pk), toDynamicRow(data));
    } else if (action === "DELETE") {
      const pk = TABLE_PK[tableName] ?? "id";
      await table.delete(getDynamicField(data, pk));
    }

    const item = buildQueueItem(tableName, action, data);
    const existing = await db.sync_queue
      .filter((candidate) => candidate.idempotency_key === item.idempotency_key)
      .first();
    if (!existing) {
      await db.sync_queue.add(item);
    } else if (action === "UPDATE" && existing.id) {
      const mergedData = { ...toDynamicRow(existing.data), ...toDynamicRow(data) };
      const rebuilt = buildQueueItem(tableName, action, mergedData);
      await db.sync_queue.update(existing.id, {
        data: mergedData,
        command_name: rebuilt.command_name,
        command_args: rebuilt.command_args,
        original_occurred_at: rebuilt.original_occurred_at,
        status: existing.status === "permanent_failure" ? "permanent_failure" : "pending",
        next_retry_at: null,
      });
    }
  });

  console.log(`Transactional mutation completed for table ${tableName} (${action})`);
  if (typeof navigator !== "undefined" && navigator.onLine) {
    processSyncQueue().catch(console.error);
  }
}

export async function queueOfflineMutation(
  tableName: string,
  action: "INSERT" | "UPDATE" | "DELETE",
  data: object
) {
  const item = buildQueueItem(tableName, action, data);
  const existing = await db.sync_queue
    .filter((candidate) => candidate.idempotency_key === item.idempotency_key)
    .first();
  if (!existing) {
    await db.sync_queue.add(item);
  } else if (action === "UPDATE" && existing.id) {
    const mergedData = { ...toDynamicRow(existing.data), ...toDynamicRow(data) };
    const rebuilt = buildQueueItem(tableName, action, mergedData);
    await db.sync_queue.update(existing.id, {
      data: mergedData,
      command_name: rebuilt.command_name,
      command_args: rebuilt.command_args,
      original_occurred_at: rebuilt.original_occurred_at,
      status: existing.status === "permanent_failure" ? "permanent_failure" : "pending",
      next_retry_at: null,
    });
  }
  console.log(`Mutation queued offline for table ${tableName} (${action})`);
  if (typeof navigator !== "undefined" && navigator.onLine) {
    await processSyncQueue();
  }
}

/**
 * Part 6 — hardened sync: per-item isolation + retry backoff.
 * Items that fail 5+ times get dead-lettered (amber in UI) instead of blocking the queue.
 */
export function omitPrimaryKeyFromUpdate(data: Record<string, unknown>, primaryKey: string): Record<string, unknown> { const updateData = { ...data }; delete updateData[primaryKey]; return updateData; }

let activeSyncQueueRun: Promise<void> | null = null;

function isDuplicateKeyError(error: { code?: string; message?: string } | null | undefined): boolean {
  return Boolean(error && (error.code === "23505" || /duplicate key|already exists/i.test(error.message ?? "")));
}

export function classifySyncError(error: unknown): {
  code: string;
  status: "retry_wait" | "permanent_failure";
} {
  const candidate = error as { code?: string; message?: string };
  const message = candidate?.message ?? String(error);
  const code = candidate?.code ?? "SYNC_UNKNOWN";
  if (
    ["22P02", "23503", "23514", "42501", "42703", "42P01", "PGRST204"].includes(code) ||
    /invalid input syntax for type uuid|foreign key|check constraint|permission denied|column .* does not exist|malformed/i.test(message)
  ) {
    return { code, status: "permanent_failure" };
  }
  return { code, status: "retry_wait" };
}

export function nextRetryDelayMs(retryCount: number): number {
  const schedule = [0, 5_000, 15_000, 60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];
  return schedule[Math.min(Math.max(retryCount - 1, 0), schedule.length - 1)];
}

async function verifyRemoteRowExists(
  remoteTableName: string,
  primaryKey: string,
  primaryKeyValue: unknown,
): Promise<boolean> {
  if (primaryKeyValue === undefined || primaryKeyValue === null || primaryKeyValue === "") return false;
  const { data, error } = await supabase
    .from(remoteTableName)
    .select(primaryKey)
    .eq(primaryKey, primaryKeyValue)
    .maybeSingle();
  if (error) throw new Error(`Supabase verification failed for ${remoteTableName}: ${error.message}`);
  return Boolean(data);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function ensureVisitEvidenceUploaded(visitId: string, storagePath: string): Promise<void> {
  const slash = storagePath.lastIndexOf("/");
  const folder = storagePath.slice(0, slash);
  const filename = storagePath.slice(slash + 1);
  const { data: existing, error: listError } = await supabase.storage
    .from("visits-evidence")
    .list(folder, { search: filename, limit: 10 });
  if (listError) throw Object.assign(new Error("Visit evidence lookup failed."), { code: listError.statusCode });
  if (existing?.some((entry) => entry.name === filename)) return;

  const media = await db.field_visit_media.where("visit_id").equals(visitId).first();
  if (!media?.media_data) throw Object.assign(new Error("Visit evidence is unavailable locally."), { code: "VISIT_MEDIA_MISSING" });
  const { error: uploadError } = await supabase.storage
    .from("visits-evidence")
    .upload(storagePath, media.media_data, { upsert: false, contentType: "image/jpeg" });
  if (uploadError) {
    const duplicate = /already exists|duplicate/i.test(uploadError.message);
    if (!duplicate) throw Object.assign(new Error("Visit evidence upload failed."), { code: uploadError.statusCode });
    const { data: reconciled, error: reconcileError } = await supabase.storage
      .from("visits-evidence")
      .list(folder, { search: filename, limit: 10 });
    if (reconcileError || !reconciled?.some((entry) => entry.name === filename)) {
      throw Object.assign(new Error("Duplicate visit evidence could not be confirmed."), { code: "VISIT_MEDIA_UNCONFIRMED" });
    }
  }
}

async function ensureLegacyKpiSourceRepairsQueued(): Promise<void> {
  const legacyCalls = await db.call_logs
    .filter((call) => typeof call.lead_id === "string" && call.lead_id.startsWith("EXCEL::"))
    .toArray();

  for (const call of legacyCalls) {
    const prepared = prepareSyncPayload("call_logs", call);
    if (!prepared.changed) continue;
    await db.transaction("rw", [db.call_logs, db.sync_queue], async () => {
      await db.call_logs.put(prepared.data as unknown as LocalCallLog);
      const alreadyQueued = await db.sync_queue
        .filter((entry) => entry.table_name === "call_logs" && getDynamicField(entry.data, "log_id") === call.log_id)
        .first();
      if (!alreadyQueued) {
        await db.sync_queue.add({
          idempotency_key: `legacy-repair:call_logs:${call.log_id}`,
          table_name: "call_logs",
          action: "INSERT",
          data: prepared.data,
          timestamp: new Date().toISOString(),
          retry_count: 0,
        });
      }
    });
  }

  const legacyTasks = await db.tasks
    .filter((task) => typeof task.related_lead_id === "string" && task.related_lead_id.startsWith("EXCEL::"))
    .toArray();

  for (const task of legacyTasks) {
    const prepared = prepareSyncPayload("tasks", task);
    if (!prepared.changed) continue;
    await db.transaction("rw", [db.tasks, db.sync_queue], async () => {
      await db.tasks.put(prepared.data as unknown as LocalTask);
      const alreadyQueued = await db.sync_queue
        .filter((entry) => entry.table_name === "tasks" && getDynamicField(entry.data, "task_id") === task.task_id)
        .first();
      if (!alreadyQueued) {
        await db.sync_queue.add({
          idempotency_key: `legacy-repair:tasks:${task.task_id}`,
          table_name: "tasks",
          action: "INSERT",
          data: prepared.data,
          timestamp: new Date().toISOString(),
          retry_count: 0,
        });
      }
    });
  }
}

async function processSyncQueueInternal(): Promise<void> {
  if (typeof navigator === "undefined" || !navigator.onLine) return;

  await ensureLegacyKpiSourceRepairsQueued();

  const items = await db.sync_queue.orderBy("id").toArray();
  if (items.length === 0) return;

  console.log(`Processing ${items.length} sync item(s)...`);

  for (const item of items) {
    if (!item.id) continue;
    if (item.status === "permanent_failure") continue;
    if (item.next_retry_at && Date.parse(item.next_retry_at) > Date.now()) continue;

    let operation = item;
    if (!isUuid(operation.operation_id) || !operation.command_name || !operation.command_args) {
      const rebuilt = buildQueueItem(operation.table_name, operation.action, operation.data);
      operation = {
        ...operation,
        ...rebuilt,
        id: operation.id,
        created_at: operation.created_at ?? operation.timestamp,
        original_occurred_at: operation.original_occurred_at ?? rebuilt.original_occurred_at,
        retry_count: operation.retry_count ?? 0,
      };
      await db.sync_queue.put(operation);
    }
    const prepared = prepareSyncPayload(operation.table_name, operation.data);
    const effectiveRetryCount = prepared.changed ? 0 : (item.retry_count ?? 0);

    // Deterministically repaired legacy call/task rows must be retried even if an
    // older build had already dead-lettered them.
    if (prepared.changed) {
      await db.sync_queue.update(item.id, {
        data: prepared.data,
        retry_count: 0,
        last_error: prepared.repairReason
          ? `Payload repaired: ${prepared.repairReason}`
          : undefined,
      });
    }

    try {
      const attemptStartedAt = performance.now();
      await db.sync_queue.update(item.id, {
        status: "syncing",
        last_attempt_at: new Date().toISOString(),
      });
      if (isSupabaseConfigured) {
        const remoteTableName = Object.keys(REMOTE_TO_LOCAL_TABLE)
          .find((key) => REMOTE_TO_LOCAL_TABLE[key] === operation.table_name) ?? operation.table_name;
        const client = supabase.from(remoteTableName);
        const primaryKey = TABLE_PK[operation.table_name] ?? "id";
        const primaryKeyValue = prepared.data[primaryKey];

        if (operation.command_name && operation.command_name !== "verified_crud") {
          const commandName = operation.command_name;
          if (operation.command_name === "create_field_visit_v1") {
            const visitId = String(prepared.data.visit_id ?? "");
            const storagePath = String(prepared.data.selfie_storage_path ?? "");
            if (!visitId || !storagePath) throw Object.assign(new Error("Visit evidence identity missing."), { code: "VISIT_MEDIA_INVALID" });
            await ensureVisitEvidenceUploaded(visitId, storagePath);
          }
          const { data: confirmedData, error: commandError } = await supabase.rpc(commandName, {
            ...(operation.command_args ?? {}),
            p_operation_id: operation.operation_id,
          });
          if (commandError) throw Object.assign(new Error(commandError.message), { code: commandError.code });
          const confirmed = Array.isArray(confirmedData) ? confirmedData[0] : confirmedData;
          if (!confirmed || typeof confirmed !== "object") {
            throw Object.assign(new Error(`${operation.command_name} returned no confirmed record.`), { code: "COMMAND_UNCONFIRMED" });
          }
          const table = dynamicTables[operation.table_name];
          await table.put({ ...toDynamicRow(confirmed), cache_confirmed_at: new Date().toISOString() });
          if (operation.command_name === "create_field_visit_v1") {
            const visitId = String(prepared.data.visit_id);
            await db.field_visits.update(visitId, { sync_status: "synced" });
            await db.field_visit_media.where("visit_id").equals(visitId).delete();
          }
        } else if (operation.action === "INSERT") {
          const { error } = await client.insert(prepared.data);
          if (error) {
            if (!isDuplicateKeyError(error) || !(await verifyRemoteRowExists(remoteTableName, primaryKey, primaryKeyValue))) {
              throw new Error(`Supabase insert failed for ${remoteTableName}: ${error.message}`);
            }
          } else if (!(await verifyRemoteRowExists(remoteTableName, primaryKey, primaryKeyValue))) {
            throw new Error(`Supabase inserted no verifiable ${remoteTableName} row.`);
          }
        } else if (operation.action === "UPDATE") {
          if (primaryKeyValue === undefined || primaryKeyValue === null || primaryKeyValue === "") {
            throw new Error(`Missing ${primaryKey} for ${item.table_name} update.`);
          }

          const updateData = omitPrimaryKeyFromUpdate(prepared.data, primaryKey);
          if (Object.keys(updateData).length === 0) {
            throw new Error(`No update fields provided for ${item.table_name}.`);
          }

          if (operation.table_name === "leads" && updateData.status !== undefined) {
            const { data: rpcData, error: rpcError } = await supabase.rpc("transition_lead_stage", {
              p_lead_id: primaryKeyValue as string,
              p_expected_current_stage: null,
              p_new_stage: updateData.status as string,
              p_actor: "agent",
            });
            if (rpcError) throw new Error(`Lead transition failed: ${rpcError.message}`);
            if (rpcData && rpcData.success === false) {
              throw new Error(String(rpcData.error ?? "Lead transition was rejected."));
            }

            const otherUpdateData = { ...updateData };
            delete otherUpdateData.status;
            if (Object.keys(otherUpdateData).length > 0) {
              const { data, error } = await client
                .update(otherUpdateData)
                .eq(primaryKey, primaryKeyValue)
                .select(primaryKey)
                .maybeSingle();
              if (error) throw new Error(`Supabase update failed for ${remoteTableName}: ${error.message}`);
              if (!data) throw new Error(`No ${remoteTableName} row was updated.`);
            } else if (!(await verifyRemoteRowExists(remoteTableName, primaryKey, primaryKeyValue))) {
              throw new Error(`Lead transition returned without a verifiable lead row.`);
            }
          } else {
            const { data, error } = await client
              .update(updateData)
              .eq(primaryKey, primaryKeyValue)
              .select(primaryKey)
              .maybeSingle();
            if (error) throw new Error(`Supabase update failed for ${remoteTableName}: ${error.message}`);
            if (!data) throw new Error(`No ${remoteTableName} row was updated.`);
          }
        } else if (operation.action === "DELETE") {
          if (primaryKeyValue === undefined || primaryKeyValue === null || primaryKeyValue === "") {
            throw new Error(`Missing ${primaryKey} for ${item.table_name} delete.`);
          }
          const { error } = await client.delete().eq(primaryKey, primaryKeyValue);
          if (error) throw new Error(`Supabase delete failed for ${remoteTableName}: ${error.message}`);
        }
      } else {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }

      await db.sync_queue.update(item.id, {
        confirmed_at: new Date().toISOString(),
        last_error_code: null,
        last_error_message: null,
      });
      await db.sync_queue.delete(item.id);
      console.info("sync_operation_confirmed", {
        operationId: operation.operation_id,
        entityType: operation.entity_type ?? operation.table_name,
        attempt: effectiveRetryCount + 1,
        durationMs: Math.round(performance.now() - attemptStartedAt),
      });

      if (item.table_name === "field_visits") {
        const visitId = prepared.data.visit_id;
        if (visitId) {
          try {
            await db.field_visits.update(visitId as string, { sync_status: "synced" } as Partial<LocalFieldVisit>);
          } catch (error) {
            console.warn("Failed to update local field visit sync state:", error);
          }
        }
      }
    } catch (error) {
      const retryCount = effectiveRetryCount + 1;
      const safeError = error instanceof Error ? error.message : String(error);
      const classification = classifySyncError(error);
      console.warn("sync_operation_failed", {
        operationId: operation.operation_id,
        entityType: operation.entity_type ?? operation.table_name,
        errorCode: classification.code,
        attempt: retryCount,
      });
      await db.sync_queue.update(item.id, {
        data: prepared.data,
        retry_count: retryCount,
        last_error: safeError,
        status: classification.status,
        next_retry_at: classification.status === "retry_wait"
          ? new Date(Date.now() + nextRetryDelayMs(retryCount)).toISOString()
          : null,
        last_error_code: classification.code,
        last_error_message: safeError,
      });

      if (item.table_name === "field_visits") {
        const visitId = prepared.data.visit_id;
        if (visitId && classification.status === "permanent_failure") {
          try {
            await db.field_visits.update(visitId as string, { sync_status: "sync_failed" } as Partial<LocalFieldVisit>);
          } catch (syncStateError) {
            console.warn("Failed to mark field visit sync failure:", syncStateError);
          }
        }
      }
    }
  }

  console.log("Sync queue pass complete.");
  const { data: authData } = await supabase.auth.getUser();
  if (authData.user) await cleanupLocalStorage(db as unknown as import("./storageCleanup").CleanupDatabase, authData.user.id);
}

export function processSyncQueue(): Promise<void> {
  if (typeof navigator === "undefined" || !navigator.onLine) return Promise.resolve();
  if (activeSyncQueueRun) return activeSyncQueueRun;

  activeSyncQueueRun = processSyncQueueInternal().finally(() => {
    activeSyncQueueRun = null;
  });
  return activeSyncQueueRun;
}

export async function getUnsynchronizedWorkCounts() {
  const items = await db.sync_queue.toArray();
  return {
    pending: items.filter((item) => !item.status || item.status === "pending" || item.status === "syncing").length,
    retry_wait: items.filter((item) => item.status === "retry_wait").length,
    permanent_failure: items.filter((item) => item.status === "permanent_failure").length,
    total: items.length,
  };
}

export interface BootstrapStatus {
  userId: string;
  refreshing: boolean;
  completedAt: string | null;
  tables: Record<string, string>;
  errorCode?: string;
}

export type HistoricalOperationalTable =
  | "call_logs"
  | "client_queries"
  | "mapping_requests"
  | "mappings"
  | "tasks"
  | "allocated_targets"
  | "field_visits";

export async function fetchHistoricalOperationalData(
  table: HistoricalOperationalTable,
  userId: string,
  before: string,
  limit = 50,
): Promise<DynamicRow[]> {
  if (!isUuid(userId)) throw new Error("A valid historical-data user is required.");
  const boundedLimit = Math.max(1, Math.min(limit, 100));
  let query = supabase.from(table).select("*");
  if (table === "call_logs") query = query.eq("user_id", userId).lt("timestamp", before);
  else if (table === "field_visits") query = query.eq("user_id", userId).lt("check_in_time", before);
  else if (table === "tasks") query = query.eq("assigned_to", userId).lt("completed_at", before);
  else if (table === "allocated_targets") query = query.eq("assigned_to_user_id", userId).lt("completed_at", before);
  else if (table === "client_queries") query = query.or(`assigned_to.eq.${userId},resolved_by.eq.${userId}`).lt("resolved_at", before);
  else if (table === "mapping_requests") query = query.or(`mapped_by.eq.${userId},requested_by.eq.${userId}`).lt("completed_at", before);
  else query = query.eq("mapped_by", userId).lt("completion_timestamp", before);
  const { data, error } = await query.limit(boundedLimit);
  if (error) throw Object.assign(new Error("Historical data is unavailable."), { code: error.code });
  return (data ?? []) as DynamicRow[];
}

export async function bootstrapOperationalData(userId: string): Promise<BootstrapStatus> {
  if (!isUuid(userId)) throw new Error("A valid bootstrap user is required.");
  const status: BootstrapStatus = {
    userId,
    refreshing: true,
    completedAt: null,
    tables: {},
  };
  if (typeof window === "undefined" || !navigator.onLine || !isSupabaseConfigured) {
    return { ...status, refreshing: false, errorCode: "BOOTSTRAP_OFFLINE" };
  }

  const since = new Date(Date.now() - STORAGE_BUDGET.recentOperationalWindowDays * DAY_MS).toISOString();
  const pending = await db.sync_queue.toArray();
  const protectedIds = new Map<string, Set<string>>();
  for (const operation of pending) {
    const ids = protectedIds.get(operation.table_name) ?? new Set<string>();
    ids.add(operation.entity_id ?? String(getDynamicField(operation.data, TABLE_PK[operation.table_name] ?? "id") ?? ""));
    protectedIds.set(operation.table_name, ids);
  }

  const sources = [
    { table: "call_logs", load: (from: number, to: number) => supabase.from("call_logs").select("*").eq("user_id", userId).gte("timestamp", since).range(from, to) },
    { table: "client_queries", load: (from: number, to: number) => supabase.from("client_queries").select("*").or(`assigned_to.eq.${userId},resolved_by.eq.${userId}`).or(`problem_status.neq.Resolved,resolved_at.gte.${since}`).range(from, to) },
    { table: "mapping_requests", load: (from: number, to: number) => supabase.from("mapping_requests").select("*").or(`mapped_by.eq.${userId},status.eq.Pending,completed_at.gte.${since}`).range(from, to) },
    { table: "mappings", load: (from: number, to: number) => supabase.from("mappings").select("*").eq("mapped_by", userId).gte("completion_timestamp", since).range(from, to) },
    { table: "tasks", load: (from: number, to: number) => supabase.from("tasks").select("*").eq("assigned_to", userId).or(`status.neq.Completed,completed_at.gte.${since}`).range(from, to) },
    { table: "task_status_history", load: (from: number, to: number) => supabase.from("task_status_history").select("*").eq("changed_by", userId).gte("changed_at", since).range(from, to) },
    { table: "allocated_targets", load: (from: number, to: number) => supabase.from("allocated_targets").select("*").eq("assigned_to_user_id", userId).or(`is_completed.eq.false,completed_at.gte.${since}`).range(from, to) },
    { table: "field_visits", load: (from: number, to: number) => supabase.from("field_visits").select("*").eq("user_id", userId).gte("check_in_time", since).range(from, to) },
  ];

  const loadSource = async (source: typeof sources[number]) => {
    const rows: DynamicRow[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await source.load(from, from + 999);
      if (error) throw Object.assign(new Error(`Bootstrap failed for ${source.table}.`), { code: error.code });
      rows.push(...((data ?? []) as DynamicRow[]));
      if (!data || data.length < 1000) break;
    }
    const primaryKey = TABLE_PK[source.table] ?? "id";
    const protectedForTable = protectedIds.get(source.table) ?? new Set<string>();
    const confirmedAt = new Date().toISOString();
    const safeRows = rows
      .filter((row) => !protectedForTable.has(String(row[primaryKey])))
      .map((row) => ({ ...row, cache_confirmed_at: confirmedAt }));
    if (safeRows.length > 0) await dynamicTables[source.table].bulkPut(safeRows);
    const completedAt = new Date().toISOString();
    status.tables[source.table] = completedAt;
    localStorage.setItem(`bootstrap:${userId}:${source.table}`, completedAt);
  };

  try {
    for (let index = 0; index < sources.length; index += 2) {
      await Promise.all(sources.slice(index, index + 2).map(loadSource));
    }
    status.completedAt = new Date().toISOString();
    localStorage.setItem(`bootstrap:${userId}:completed`, status.completedAt);
    await cleanupLocalStorage(db as unknown as import("./storageCleanup").CleanupDatabase, userId);
    return { ...status, refreshing: false };
  } catch (error) {
    const code = (error as { code?: string }).code ?? "BOOTSTRAP_FAILED";
    return { ...status, refreshing: false, errorCode: code };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PULL DOWN SYNC — Fetch full dataset from Supabase for local robustness
// ─────────────────────────────────────────────────────────────────────────────

export async function pullDownSync() {
  if (typeof window === "undefined" || !navigator.onLine || !isSupabaseConfigured) {
    return;
  }
  const { data: authData } = await supabase.auth.getUser();
  // Remote-empty bootstrap pages are authoritative: local data was preserved without recovery writes.
  if (authData.user) await bootstrapOperationalData(authData.user.id);
}


// ─────────────────────────────────────────────────────────────────────────────
// AUTO SYNC & REALTIME SUBSCRIPTIONS
// ─────────────────────────────────────────────────────────────────────────────

if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    console.log("Browser went online. Triggering sync...");
    processSyncQueue().catch(console.error);
    pullDownSync().catch(console.error);
  });

  // Trigger sync when tab becomes active again to ensure fresh data
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && navigator.onLine) {
       console.log("Tab focused. Checking sync throttle...");
       processSyncQueue().catch(console.error);

       const lastSyncStr = localStorage.getItem("last_pull_sync");
       const lastSync = lastSyncStr ? parseInt(lastSyncStr, 10) : 0;

       // Throttle pullDownSync to once every 5 minutes (300000 ms)
       if (Date.now() - lastSync > 300000) {
         console.log("Throttle passed. Triggering full pullDownSync...");
         pullDownSync().catch(console.error);
       } else {
         console.log("pullDownSync throttled to prevent usage limit exceedance. Realtime WebSocket will handle active updates.");
       }
    }
  });

  // Initialize Supabase Realtime for instant offline-first syncing
  if (isSupabaseConfigured) {
    const validTables = [
      "users", "capabilities", "user_capabilities", "leads",
      "client_queries", "mappings", "mapping_requests", "task_templates",
      "tasks", "task_status_history", "internal_tickets", "attendance", "call_logs",
      "lead_registration_checklist",
      "lead_installation_details", "lead_payment_details",
      "task_upload_batches", "allocated_targets"
    ];

    supabase.channel('schema-db-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public' },
        async (payload) => {
          try {
            const tableName = payload.table;
            if (!validTables.includes(tableName)) return;

            const table = dynamicTables[tableName];
            if (!table) return;

            const pk = TABLE_PK[tableName] ?? "id";

            if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
              const record: DynamicRow = { ...payload.new, cache_confirmed_at: new Date().toISOString() };

              // Skip if we have a pending offline mutation for this item (our local version is newer)
              const pendingMutation = await db.sync_queue
                .where("table_name").equals(tableName)
                .and(item => getDynamicField(item.data, pk) === record[pk])
                .first();

              if (!pendingMutation) {
                await db.transaction('rw', table, async () => {
                  await table.put(record);
                });
              }
            } else if (payload.eventType === 'DELETE') {
              const oldRecord = payload.old;
              if (oldRecord && oldRecord[pk]) {
                await db.transaction('rw', table, async () => {
                  await table.delete(oldRecord[pk]);
                });
              }
            }
          } catch (err) {
            console.error(`Error processing realtime event for ${payload.table}:`, err);
          }
        }
      )
      .subscribe((status) => {
        console.log("Supabase Realtime status:", status);
      });
  }
}
