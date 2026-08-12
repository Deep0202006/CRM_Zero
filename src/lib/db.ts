import Dexie, { type Table } from "dexie";
import { LeadSegment, LeadStatus } from "./validation";
import { supabase, isSupabaseConfigured } from "./supabaseClient";
import { prepareSyncPayload } from "./syncPayload";
import { isActiveSyncQueueItem, isLegacyPipelineStatusMutation, LEGACY_PIPELINE_STATUS_ERROR, preserveLegacyNonStatusUpdate } from "./pipeline/legacyQueue";

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
  owner_name?: string;
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
  selfie_url?: string | null; // Legacy embedded evidence; new records keep this null.
  selfie_captured?: boolean;
  selfie_storage_path?: string | null;
  selfie_uploaded_at?: string | null;
  selfie_purged_at?: string | null;
  selfie_purge_state?: "available" | "purge_pending" | "purged" | null;
  selfie_purge_started_at?: string | null;
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
  address?: string | null;
  segment_type?: string | null;
  follow_up_date?: string | null;
  sync_status?: 'pending_sync' | 'synced' | 'sync_failed';
  sync_stage?: 'pending_visit' | 'address_required' | 'visit_confirmed_evidence_pending' | 'visit_confirmed_link_pending' | 'synced' | 'sync_failed';
  confirmation_mode?: 'new' | 'recovery';
  sync_error_code?: string;
  sync_error_message?: string;
  sync_attempt_count?: number;
  last_sync_attempt_at?: string;
  created_at: string;
  updated_at: string;
}

export interface LocalFieldVisitMedia {
  media_id: string;
  visit_id: string;
  user_id: string;
  media_data: Blob | string; // Blob for new captures; legacy Base64 remains readable.
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
  idempotency_key: string;
  owner_user_id?: string;
  table_name: string;
  action: "INSERT" | "UPDATE" | "DELETE";
  data: object;
  timestamp: string;
  retry_count?: number;  // Part 6 — per-item retry tracking
  last_error?: string;   // Part 6 — surfaces dead-letter failures in UI
  next_retry_at?: string;
  recovery_state?: "recovered" | "satisfied" | "review_required" | "quarantined";
  recovery_reason?: string;
  recovery_marked_at?: string;
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

    // Version 14 keeps the existing stores intact. Attendance evidence lives
    // as a Blob in its durable outbox item until exact server confirmation.
    this.version(14).stores({
      users: "user_id, email, is_active, manager_id", capabilities: "code",
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
      task_status_history: "id, task_id, changed_at", kpi_snapshots: "snapshot_id, user_id, date, [user_id+date]",
      lead_registration_checklist: "checklist_id, lead_id", lead_installation_details: "installation_id, lead_id",
      lead_payment_details: "payment_id, lead_id", task_upload_batches: "id, uploaded_by, file_hash",
      allocated_targets: "target_id, batch_id, assigned_to_user_id, city, is_completed, [assigned_to_user_id+is_completed+city]",
      field_visits: "visit_id, lead_id, user_id, visit_date, sync_status, [user_id+visit_date]",
      field_visit_media: "media_id, visit_id, user_id"
    });
  }
}

export const db = new CRMDatabase();

export async function saveAttendanceWithEvidence(attendance: LocalAttendance, evidence: Blob | null): Promise<void> {
  await db.transaction("rw", [db.attendance, db.sync_queue], async () => {
    await db.attendance.add({ ...attendance, selfie_url: null, selfie_captured: Boolean(evidence) });
    await db.sync_queue.add({
      idempotency_key: `attendance:${attendance.attendance_id}`,
      owner_user_id: claimSyncQueueOwnership(),
      table_name: "attendance",
      action: "INSERT",
      data: { ...attendance, selfie_url: null, selfie_blob: evidence },
      timestamp: new Date().toISOString(),
    });
  });
  if (typeof navigator !== "undefined" && navigator.onLine) void processSyncQueue();
}

export async function countActiveSyncQueueItems(): Promise<number> {
  return db.sync_queue.filter(isActiveSyncQueueItem).count();
}

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

    const item: SyncQueueItem = {
      idempotency_key: crypto.randomUUID(),
      owner_user_id: claimSyncQueueOwnership(),
      table_name: tableName,
      action,
      data,
      timestamp: new Date().toISOString(),
    };
    await db.sync_queue.add(item);
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
  const item: SyncQueueItem = {
    idempotency_key: crypto.randomUUID(),
    owner_user_id: claimSyncQueueOwnership(),
    table_name: tableName,
    action,
    data,
    timestamp: new Date().toISOString(),
  };
  await db.sync_queue.add(item);
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
let syncQueueRerunRequested = false;
const temporarilyExcludedSyncKeys = new Set<string>();

class SyncAttemptError extends Error {
  constructor(message: string, readonly retryable: boolean) { super(message); }
}

const MAX_SYNC_RETRY_DELAY_MS = 60 * 60 * 1000;
export function syncRetryDelayMs(retryCount: number): number {
  return Math.min(MAX_SYNC_RETRY_DELAY_MS, 60_000 * 2 ** Math.max(0, retryCount - 1));
}

function retryIsDue(item: SyncQueueItem): boolean {
  return !item.next_retry_at || Date.parse(item.next_retry_at) <= Date.now();
}

function isEventuallyRetryableBusinessItem(item: SyncQueueItem): boolean {
  return (item.table_name === "call_logs" && item.action === "INSERT") ||
    item.idempotency_key.startsWith("followup-completion-task:") ||
    item.idempotency_key.startsWith("followup-completion-history:") ||
    item.idempotency_key.startsWith("followup-completion-call:");
}

function isDuplicateKeyError(error: { code?: string; message?: string } | null | undefined): boolean {
  return Boolean(error && (error.code === "23505" || /duplicate key|already exists/i.test(error.message ?? "")));
}

async function verifyRemoteRowExists(
  remoteTableName: string,
  primaryKey: string,
  primaryKeyValue: unknown,
  authenticatedUserId?: string,
): Promise<boolean> {
  if (primaryKeyValue === undefined || primaryKeyValue === null || primaryKeyValue === "") return false;
  let query = supabase
    .from(remoteTableName)
    .select(primaryKey)
    .eq(primaryKey, primaryKeyValue);
  if (remoteTableName === "call_logs" && authenticatedUserId) query = query.eq("user_id", authenticatedUserId);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(`Supabase verification failed for ${remoteTableName}: ${error.message}`);
  return Boolean(data);
}

async function confirmCallLog(payload: Record<string, unknown>, accessToken: string): Promise<void> {
  const response = await fetch("/api/call-logs/confirm", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  let result: { ok?: boolean; code?: string; log_id?: string };
  try { result = await response.json() as typeof result; }
  catch { throw new SyncAttemptError("Call confirmation returned an unreadable response.", true); }
  if (!response.ok || !result.ok || !["CALL_CONFIRMED", "CALL_ALREADY_CONFIRMED"].includes(result.code ?? "") || result.log_id !== payload.log_id) {
    const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
    throw new SyncAttemptError(`Call confirmation failed (${result.code ?? response.status}).`, retryable);
  }
}

async function legacyDataUrlToBlob(value: unknown): Promise<Blob | null> {
  if (value instanceof Blob) return value;
  if (typeof value !== "string" || !value.startsWith("data:image/")) return null;
  const response = await fetch(value);
  return response.blob();
}

async function confirmAttendance(item: SyncQueueItem, accessToken: string): Promise<Record<string, unknown>> {
  const payload = toDynamicRow(item.data);
  const evidence = await legacyDataUrlToBlob(payload.selfie_blob ?? payload.selfie_url);
  const form = new FormData();
  const business = { ...payload };
  delete business.selfie_blob;
  form.set("attendance", JSON.stringify({ ...business, selfie_url: null }));
  if (evidence) form.set("selfie", new File([evidence], "attendance.jpg", { type: evidence.type || "image/jpeg" }));
  const response = await fetch("/api/attendance/confirm", { method: "POST", headers: { Authorization: `Bearer ${accessToken}` }, body: form, cache: "no-store" });
  let result: { ok?: boolean; code?: string; attendance_id?: string; attendance?: Record<string, unknown> };
  try { result = await response.json() as typeof result; }
  catch { throw new SyncAttemptError("Attendance confirmation returned an unreadable response.", true); }
  const expectedId = String(payload.attendance_id ?? "");
  if (!response.ok || !result.ok || !["ATTENDANCE_CONFIRMED", "ATTENDANCE_ALREADY_CONFIRMED"].includes(result.code ?? "") || result.attendance_id !== expectedId) {
    throw new SyncAttemptError(`Attendance confirmation failed (${result.code ?? response.status}).`, response.status === 408 || response.status === 429 || response.status >= 500);
  }
  return result.attendance ?? business;
}

/**
 * Confirms one exact durable call outbox item without waiting for older queue
 * work. It deliberately shares the normal payload repair and confirmation
 * route; the general queue remains responsible for retries and other work.
 */
export async function confirmQueuedCallLog(logId: string): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.onLine || !isSupabaseConfigured) return false;

  const idempotencyKey = `call-log:${logId}`;
  const item = await db.sync_queue.where("idempotency_key").equals(idempotencyKey).first();
  if (!item?.id || item.table_name !== "call_logs" || item.action !== "INSERT") return false;

  const [{ data: authenticated, error: authenticationError }, { data: sessionData }] = await Promise.all([
    supabase.auth.getUser(),
    supabase.auth.getSession(),
  ]);
  const authenticatedUserId = authenticated.user?.id;
  const accessToken = sessionData.session?.access_token;
  if (authenticationError || !authenticatedUserId || !accessToken) return false;

  const legacyOwnerId = localStorage.getItem(OUTBOX_OWNER_KEY) ?? localStorage.getItem("authenticated_user_id");
  const itemOwnerId = item.owner_user_id ?? legacyOwnerId;
  if (!itemOwnerId || itemOwnerId !== authenticatedUserId) return false;
  if (!item.owner_user_id) await db.sync_queue.update(item.id, { owner_user_id: itemOwnerId });

  const prepared = prepareSyncPayload(item.table_name, item.data);
  if (prepared.changed) {
    await db.sync_queue.update(item.id, {
      data: prepared.data,
      retry_count: 0,
      last_error: prepared.repairReason ? `Payload repaired: ${prepared.repairReason}` : undefined,
    });
  }

  try {
    await confirmCallLog(prepared.data, accessToken);
    const current = await db.sync_queue.get(item.id);
    if (current?.idempotency_key === idempotencyKey) await db.sync_queue.delete(item.id);
    if ((await countActiveSyncQueueItems()) === 0) localStorage.removeItem(OUTBOX_OWNER_KEY);
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("zerodata:call-logs-changed"));
    return true;
  } catch (error) {
    const current = await db.sync_queue.get(item.id);
    if (current?.idempotency_key === idempotencyKey) {
      const retryable = !(error instanceof SyncAttemptError) || error.retryable;
      const retryCount = retryable ? (prepared.changed ? 0 : (item.retry_count ?? 0)) + 1 : Math.max(5, item.retry_count ?? 0);
      await db.sync_queue.update(item.id, {
        data: prepared.data,
        retry_count: retryCount,
        last_error: error instanceof Error ? error.message : String(error),
        ...(retryable
          ? { next_retry_at: new Date(Date.now() + syncRetryDelayMs(retryCount)).toISOString() }
          : { recovery_state: "review_required", recovery_reason: "PERMANENT_CALL_CONFIRMATION_FAILURE", recovery_marked_at: new Date().toISOString(), next_retry_at: undefined }),
      });
    }
    return false;
  }
}

async function processSyncQueueInternal(): Promise<void> {
  if (typeof navigator === "undefined" || !navigator.onLine) return;

  const [{ data: authenticated, error: authenticationError }, { data: sessionData }] = await Promise.all([supabase.auth.getUser(), supabase.auth.getSession()]);
  const authenticatedUserId = authenticated.user?.id;
  const accessToken = sessionData.session?.access_token;
  if (authenticationError || !authenticatedUserId || !accessToken) return;

  const items = await db.sync_queue.orderBy("id").toArray();
  if (!items.some(isActiveSyncQueueItem)) {
    localStorage.removeItem(OUTBOX_OWNER_KEY);
    return;
  }
  const legacyOwnerId =
    localStorage.getItem(OUTBOX_OWNER_KEY) ??
    localStorage.getItem("authenticated_user_id");

  console.log(`Processing ${items.length} sync item(s)...`);

  for (const item of items) {
    if (!item.id) continue;
    if (temporarilyExcludedSyncKeys.has(item.idempotency_key)) continue;
    if (!retryIsDue(item)) continue;
    const itemOwnerId = item.owner_user_id ?? legacyOwnerId;
    if (!itemOwnerId || itemOwnerId !== authenticatedUserId) continue;
    if (!item.owner_user_id) {
      await db.sync_queue.update(item.id, { owner_user_id: itemOwnerId });
    }

    // Field visits are confirmed only through /api/field-visits/confirm. Keep
    // any legacy queue item intact for recovery, but never replay its browser
    // Supabase insert through this generic writer.
    if (item.table_name === "field_visits") continue;

    // Attendance inserts, including legacy queued data URLs, converge through
    // the stable-ID server confirmation route. Generic Supabase insert is forbidden.
    if (item.table_name === "attendance" && item.action === "INSERT") {
      try {
        const confirmed = await confirmAttendance(item, accessToken);
        await db.transaction("rw", [db.attendance, db.sync_queue], async () => {
          await db.attendance.update(String(toDynamicRow(item.data).attendance_id), confirmed as Partial<LocalAttendance>);
          await db.sync_queue.delete(item.id!);
        });
      } catch (error) {
        const retryable = !(error instanceof SyncAttemptError) || error.retryable;
        const retryCount = retryable ? (item.retry_count ?? 0) + 1 : Math.max(5, item.retry_count ?? 0);
        await db.sync_queue.update(item.id, { retry_count: retryCount, last_error: error instanceof Error ? error.message : String(error), ...(retryable ? { next_retry_at: new Date(Date.now() + syncRetryDelayMs(retryCount)).toISOString() } : { recovery_state: "review_required", recovery_reason: "PERMANENT_ATTENDANCE_CONFIRMATION_FAILURE", recovery_marked_at: new Date().toISOString(), next_retry_at: undefined }) });
      }
      continue;
    }

      if (isLegacyPipelineStatusMutation(item)) {
        const preserved = preserveLegacyNonStatusUpdate(item);
        await db.transaction("rw", db.sync_queue, async () => {
          await db.sync_queue.update(item.id!, { data: preserved.originalData, last_error: LEGACY_PIPELINE_STATUS_ERROR });
          if (preserved.replayData) {
            await db.sync_queue.add({
              idempotency_key: `${item.idempotency_key}:non-status`,
              owner_user_id: itemOwnerId,
              table_name: "leads",
              action: "UPDATE",
              data: preserved.replayData,
              timestamp: item.timestamp,
            });
          }
        });
        continue;
      }

      if (item.table_name === "pipeline_transition_commands") continue;

    if (
      item.idempotency_key.startsWith("followup-completion-history:") ||
      item.idempotency_key.startsWith("followup-completion-call:")
    ) {
      const taskId = item.idempotency_key.split(":").at(-1);
      const prerequisitePrefixes = item.idempotency_key.startsWith("followup-completion-call:")
        ? ["followup-completion-task:", "followup-completion-history:"]
        : ["followup-completion-task:"];
      const prerequisitePending = await db.sync_queue
        .filter(
          (candidate) =>
            candidate.id !== item.id &&
            prerequisitePrefixes.some((prefix) => candidate.idempotency_key === `${prefix}${taskId}`),
        )
        .first();
      if (prerequisitePending) continue;
    }

    const prepared = prepareSyncPayload(item.table_name, item.data);
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
    } else if (effectiveRetryCount >= 5 && !isEventuallyRetryableBusinessItem(item)) {
      continue;
    }

    try {
      if (isSupabaseConfigured) {
        const remoteTableName = Object.keys(REMOTE_TO_LOCAL_TABLE)
          .find((key) => REMOTE_TO_LOCAL_TABLE[key] === item.table_name) ?? item.table_name;
        const client = supabase.from(remoteTableName);
        const primaryKey = TABLE_PK[item.table_name] ?? "id";
        const primaryKeyValue = prepared.data[primaryKey];

        if (item.action === "INSERT") {
          if (item.table_name === "call_logs") {
            await confirmCallLog(prepared.data, accessToken);
          } else {
            const { error } = await client.insert(prepared.data);
            if (error) {
              if (!isDuplicateKeyError(error) || !(await verifyRemoteRowExists(remoteTableName, primaryKey, primaryKeyValue, authenticatedUserId))) {
                throw new Error(`Supabase insert failed for ${remoteTableName}: ${error.message}`);
              }
            } else if (!(await verifyRemoteRowExists(remoteTableName, primaryKey, primaryKeyValue, authenticatedUserId))) {
              throw new Error(`Supabase inserted no verifiable ${remoteTableName} row.`);
            }
          }
        } else if (item.action === "UPDATE") {
          if (primaryKeyValue === undefined || primaryKeyValue === null || primaryKeyValue === "") {
            throw new Error(`Missing ${primaryKey} for ${item.table_name} update.`);
          }

          const updateData = omitPrimaryKeyFromUpdate(prepared.data, primaryKey);
          if (Object.keys(updateData).length === 0) {
            throw new Error(`No update fields provided for ${item.table_name}.`);
          }

          const { data, error } = await client
            .update(updateData)
            .eq(primaryKey, primaryKeyValue)
            .select(primaryKey)
            .maybeSingle();
          if (error) throw new Error(`Supabase update failed for ${remoteTableName}: ${error.message}`);
          if (!data) throw new Error(`No ${remoteTableName} row was updated.`);
        } else if (item.action === "DELETE") {
          if (primaryKeyValue === undefined || primaryKeyValue === null || primaryKeyValue === "") {
            throw new Error(`Missing ${primaryKey} for ${item.table_name} delete.`);
          }
          const { error } = await client.delete().eq(primaryKey, primaryKeyValue);
          if (error) throw new Error(`Supabase delete failed for ${remoteTableName}: ${error.message}`);
        }
      } else {
        if (item.table_name === "call_logs" && item.action === "INSERT") {
          throw new Error("Call confirmation is unavailable until Supabase is configured.");
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
      }

      await db.sync_queue.delete(item.id);

      if (item.table_name === "call_logs" && typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("zerodata:call-logs-changed"));
      }

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
      const retryable = !(error instanceof SyncAttemptError) || error.retryable;
      const retryCount = retryable ? effectiveRetryCount + 1 : Math.max(5, effectiveRetryCount);
      const safeError = error instanceof Error ? error.message : String(error);
      console.warn(`Sync item ${item.id} failed (attempt ${retryCount}):`, safeError);
      await db.sync_queue.update(item.id, {
        data: prepared.data,
        retry_count: retryCount,
        last_error: safeError,
        ...(retryable
          ? { next_retry_at: new Date(Date.now() + syncRetryDelayMs(retryCount)).toISOString() }
          : { recovery_state: "review_required", recovery_reason: "PERMANENT_SYNC_FAILURE", recovery_marked_at: new Date().toISOString(), next_retry_at: undefined }),
      });

      if (item.table_name === "field_visits") {
        const visitId = prepared.data.visit_id;
        if (visitId && retryCount >= 5) {
          try {
            await db.field_visits.update(visitId as string, { sync_status: "sync_failed" } as Partial<LocalFieldVisit>);
          } catch (syncStateError) {
            console.warn("Failed to mark field visit sync failure:", syncStateError);
          }
        }
      }
    }
  }

  if ((await countActiveSyncQueueItems()) === 0) {
    localStorage.removeItem(OUTBOX_OWNER_KEY);
  }
  console.log("Sync queue pass complete.");
}

export function processSyncQueue(): Promise<void> {
  if (typeof navigator === "undefined" || !navigator.onLine) return Promise.resolve();
  if (activeSyncQueueRun) {
    syncQueueRerunRequested = true;
    return activeSyncQueueRun;
  }

  activeSyncQueueRun = (async () => {
    do {
      syncQueueRerunRequested = false;
      await processSyncQueueInternal();
    } while (syncQueueRerunRequested);
  })().finally(() => {
    activeSyncQueueRun = null;
  });
  return activeSyncQueueRun;
}

/** Drains the existing outbox while avoiding an immediate duplicate attempt. */
export async function processSyncQueueExcept(idempotencyKey: string): Promise<void> {
  temporarilyExcludedSyncKeys.add(idempotencyKey);
  try {
    await processSyncQueue();
  } finally {
    temporarilyExcludedSyncKeys.delete(idempotencyKey);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PULL DOWN SYNC — Fetch full dataset from Supabase for local robustness
// ─────────────────────────────────────────────────────────────────────────────

const FULL_PULL_MIN_INTERVAL_MS = 30 * 60 * 1000;
const HYDRATION_COLUMNS: Record<string, string> = {
  // Evidence payloads are never part of ordinary hydration. Legacy data URLs
  // remain server-side until the explicitly authorized lifecycle purge.
  attendance: "attendance_id,user_id,date,clock_in,clock_out,latitude,longitude,selfie_captured,selfie_storage_path,selfie_uploaded_at,selfie_purged_at,selfie_purge_state",
};
let activePullDownSync: Promise<void> | null = null;
function fullPullSyncKey(): string {
  return `last_pull_sync:${localStorage.getItem("authenticated_user_id") ?? "anonymous"}`;
}

async function pullDownSyncInternal() {
  if (typeof window === "undefined" || !navigator.onLine || !isSupabaseConfigured) {
    return;
  }

  console.log("Pulling latest data from Supabase...");
  try {
    const tables = [
      "users",
      "capabilities",
      "user_capabilities",
      "leads",
      "client_queries",
      "mappings",
      "mapping_requests",
      "task_templates",
      "tasks",
      "task_status_history",
      "internal_tickets",
      "attendance",
      "call_logs",
      "task_upload_batches",
      "allocated_targets",
      "field_visits",
      "lead_registration_checklist",
      "lead_installation_details",
      "lead_payment_details",
    ];

    for (const remoteTableName of tables) {
      const localTableName = REMOTE_TO_LOCAL_TABLE[remoteTableName] || remoteTableName;
      const pk = TABLE_PK[localTableName] ?? "id";
      let allData: DynamicRow[] = [];
      let from = 0;
      const limit = 1000;
      let fetchError = null;

      while (true) {
        const { data, error } = await supabase
          .from(remoteTableName)
          .select(HYDRATION_COLUMNS[remoteTableName] ?? "*")
          .order(pk, { ascending: true })
          .range(from, from + limit - 1);
        if (error) {
          fetchError = error;
          break;
        }
        if (data && data.length > 0) {
          allData = allData.concat(data as unknown as DynamicRow[]);
          from += limit;
          if (data.length < limit) break;
        } else {
          break;
        }
      }

      if (fetchError && allData.length === 0) {
        console.warn(`Failed to pull table ${remoteTableName}:`, fetchError);
        continue;
      }

      const data = allData;

      if (data && data.length > 0) {
        const table = dynamicTables[localTableName];

        // Find local items
        const localItems = await table.toArray();
        const localIds = new Set(localItems.map((item: DynamicRow) => item[pk]));
        const remoteIds = new Set(data.map((d: DynamicRow) => d[pk]));

        // Get IDs in local that are NOT in remote
        const idsToDelete = [...localIds].filter(id => !remoteIds.has(id));

        // Check if these IDs are waiting to be inserted in the sync_queue
        const pendingInserts = await db.sync_queue
          .filter(item => item.table_name === localTableName && item.action === "INSERT")
          .toArray();
        const pendingInsertIds = new Set(pendingInserts.map(item => getDynamicField(item.data, pk)));

        const safeIdsToDelete = idsToDelete.filter(id => !pendingInsertIds.has(id));

        // Check if items have pending updates or deletes in the sync_queue
        const pendingMutations = await db.sync_queue
          .filter(item => isActiveSyncQueueItem(item) && item.table_name === localTableName && (item.action === "UPDATE" || item.action === "DELETE"))
          .toArray();
        const pendingMutationIds = new Set(pendingMutations.map(item => getDynamicField(item.data, pk)));

        const safeDataToPut = data.filter(
          (d: DynamicRow) =>
            !pendingInsertIds.has(d[pk]) &&
            !pendingMutationIds.has(d[pk]),
        );

        await db.transaction('rw', table, async () => {
          if (safeIdsToDelete.length > 0) {
            // DO NOT DELETE LOCAL DATA! The user explicitly requested to never remove data.
            // Old data purged from Supabase should remain accessible locally.
            // await table.bulkDelete(safeIdsToDelete);
          }
          if (safeDataToPut.length > 0) {
            await table.bulkPut(safeDataToPut);
          }
        });
      } else if (data && data.length === 0) {
        // An empty result can mean either a genuinely empty remote table or an
        // RLS-restricted view. Never repopulate the server from browser cache.
        // Pending writes are already represented explicitly in sync_queue and
        // are the only local records allowed to travel upward.
        console.info(`Remote table ${remoteTableName} returned no visible rows; local data was preserved without recovery writes.`);
      }
    }

    console.log("Downward sync complete.");
    localStorage.setItem(fullPullSyncKey(), Date.now().toString());
  } catch (err) {
    console.error("Failed to perform pull down sync:", err);
  }
}

export function pullDownSync(): Promise<void> {
  if (typeof window === "undefined" || !navigator.onLine || !isSupabaseConfigured) return Promise.resolve();
  if (activePullDownSync) return activePullDownSync;

  const lastSync = Number.parseInt(localStorage.getItem(fullPullSyncKey()) ?? "0", 10);
  if (Number.isFinite(lastSync) && Date.now() - lastSync < FULL_PULL_MIN_INTERVAL_MS) return Promise.resolve();

  // Claim the cooldown before I/O so login, online, visibility, and sibling-tab
  // triggers converge on one hydration pass instead of multiplying full pulls.
  localStorage.setItem(fullPullSyncKey(), Date.now().toString());
  activePullDownSync = pullDownSyncInternal().finally(() => { activePullDownSync = null; });
  return activePullDownSync;
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

       const lastSyncStr = localStorage.getItem(fullPullSyncKey());
       const lastSync = lastSyncStr ? parseInt(lastSyncStr, 10) : 0;

       // pullDownSync also enforces the shared 30-minute cooldown so duplicate
       // login, online, visibility, and sibling-tab triggers remain bounded.
       if (Date.now() - lastSync > FULL_PULL_MIN_INTERVAL_MS) {
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
              const record = payload.new;

              // Skip if we have a pending offline mutation for this item (our local version is newer)
              const pendingMutation = await db.sync_queue
                .where("table_name").equals(tableName)
                .and(item => isActiveSyncQueueItem(item) && getDynamicField(item.data, pk) === record[pk])
                .first();

              if (!pendingMutation) {
                await db.transaction('rw', table, async () => {
                  await table.put(record);
                });
                if (tableName === "call_logs") {
                  window.dispatchEvent(new CustomEvent("zerodata:call-logs-changed"));
                }
              }
            } else if (payload.eventType === 'DELETE') {
              const oldRecord = payload.old;
              if (oldRecord && oldRecord[pk]) {
                const pendingMutation = await db.sync_queue
                  .where("table_name").equals(tableName)
                  .and(item => isActiveSyncQueueItem(item) && getDynamicField(item.data, pk) === oldRecord[pk])
                  .first();
                if (pendingMutation) return;
                await db.transaction('rw', table, async () => {
                  await table.delete(oldRecord[pk]);
                });
                if (tableName === "call_logs") {
                  window.dispatchEvent(new CustomEvent("zerodata:call-logs-changed"));
                }
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

const OUTBOX_OWNER_KEY = "zerodata_outbox_owner_id";

export function claimSyncQueueOwnership(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const currentUserId = localStorage.getItem("authenticated_user_id") ?? undefined;
  if (!currentUserId) return undefined;
  const existingOwner = localStorage.getItem(OUTBOX_OWNER_KEY);
  if (existingOwner && existingOwner !== currentUserId) {
    throw new Error("Unsynchronized work belongs to another signed-in user.");
  }
  localStorage.setItem(OUTBOX_OWNER_KEY, currentUserId);
  return currentUserId;
}
