import Dexie, { type Table } from "dexie";
import { LeadSegment, LeadStatus } from "./validation";
import { supabase, isSupabaseConfigured } from "./supabaseClient";

// ─────────────────────────────────────────────────────────────────────────────
// INTERFACES — base system
// ─────────────────────────────────────────────────────────────────────────────

export interface LocalUser {
  user_id: string;
  name: string;
  email: string;
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
  lead_id: string;
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

// ─────────────────────────────────────────────────────────────────────────────
// INTERFACES — Sync queue (Part 6 hardening)
// ─────────────────────────────────────────────────────────────────────────────

export interface SyncQueueItem {
  id?: number;
  idempotency_key: string;
  table_name: string;
  action: "INSERT" | "UPDATE" | "DELETE";
  data: any;
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
  capabilities: "code",
  user_capabilities: "id",
};

// ─────────────────────────────────────────────────────────────────────────────
// OFFLINE QUEUE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

export async function transactionalMutation(
  tableName: string,
  action: "INSERT" | "UPDATE" | "DELETE",
  data: any
) {
  const table = (db as any)[tableName];
  await db.transaction('rw', [table, db.sync_queue], async () => {
    if (action === "INSERT") {
      await table.add(data);
    } else if (action === "UPDATE") {
      const pk = TABLE_PK[tableName] ?? "id";
      await table.update(data[pk], data);
    } else if (action === "DELETE") {
      const pk = TABLE_PK[tableName] ?? "id";
      await table.delete(data[pk]);
    }

    const item: SyncQueueItem = {
      idempotency_key: crypto.randomUUID(),
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
  data: any
) {
  const item: SyncQueueItem = {
    idempotency_key: crypto.randomUUID(),
    table_name: tableName,
    action,
    data,
    timestamp: new Date().toISOString(),
  };
  await db.sync_queue.add(item);
  console.log(`Mutation queued offline for table ${tableName} (${action})`);
  if (navigator.onLine) {
    await processSyncQueue();
  }
}

/**
 * Part 6 — hardened sync: per-item isolation + retry backoff.
 * Items that fail 5+ times get dead-lettered (amber in UI) instead of blocking the queue.
 */
export async function processSyncQueue() {
  if (!navigator.onLine) return;
  const items = await db.sync_queue.orderBy("id").toArray();
  if (items.length === 0) return;

  console.log(`Processing ${items.length} sync item(s)...`);

  for (const item of items) {
    // Skip dead-lettered items (retry_count >= 5) — they stay in queue for UI visibility
    if ((item.retry_count ?? 0) >= 5) continue;

    try {
      if (isSupabaseConfigured) {
        const client = supabase.from(item.table_name);
        let error: any = null;

        if (item.action === "INSERT") {
          const { error: err } = await client.insert(item.data);
          error = err;
        } else if (item.action === "UPDATE") {
          const pk = TABLE_PK[item.table_name] ?? "id";
          const pkValue = item.data[pk];
          if (pkValue) {
            const { error: err } = await client.update(item.data).eq(pk, pkValue);
            error = err;
          }
        } else if (item.action === "DELETE") {
          const pk = TABLE_PK[item.table_name] ?? "id";
          const pkValue = item.data[pk];
          if (pkValue) {
            const { error: err } = await client.delete().eq(pk, pkValue);
            error = err;
          }
        }

        if (error) throw new Error(`Supabase error: ${error.message}`);
      } else {
        // Offline-demo mode — simulate network delay
        await new Promise((resolve) => setTimeout(resolve, 200));
      }

      // Success — delete from queue
      if (item.id) await db.sync_queue.delete(item.id);
    } catch (err) {
      const retryCount = (item.retry_count ?? 0) + 1;
      console.warn(`Sync item ${item.id} failed (attempt ${retryCount}):`, err);
      await db.sync_queue.update(item.id!, {
        retry_count: retryCount,
        last_error: String(err),
      });
      // continue — do NOT block the queue for subsequent items
    }
  }

  console.log("Sync queue pass complete.");
}

// ─────────────────────────────────────────────────────────────────────────────
// PULL DOWN SYNC — Fetch full dataset from Supabase for local robustness
// ─────────────────────────────────────────────────────────────────────────────

export async function pullDownSync() {
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
      "mapping_requests",
      "task_templates",
      "tasks",
      "internal_tickets",
      "attendance",
      "call_logs",
      "kpi_daily_snapshot",
    ];

    for (const tableName of tables) {
      const { data, error } = await supabase.from(tableName).select("*");
      if (error) {
        console.warn(`Failed to pull table ${tableName}:`, error);
        continue;
      }
      
      if (data && data.length > 0) {
        const table = (db as any)[tableName];
        const pk = TABLE_PK[tableName] ?? "id";
        
        // Find local items
        const localItems = await table.toArray();
        const localIds = new Set(localItems.map((item: any) => item[pk]));
        const remoteIds = new Set(data.map((d: any) => d[pk]));

        // Get IDs in local that are NOT in remote
        const idsToDelete = [...localIds].filter(id => !remoteIds.has(id));

        // Check if these IDs are waiting to be inserted in the sync_queue
        const pendingInserts = await db.sync_queue
          .filter(item => item.table_name === tableName && item.action === "INSERT")
          .toArray();
        const pendingInsertIds = new Set(pendingInserts.map(item => item.data[pk]));

        const safeIdsToDelete = idsToDelete.filter(id => !pendingInsertIds.has(id));

        // Check if items have pending updates or deletes in the sync_queue
        const pendingMutations = await db.sync_queue
          .filter(item => item.table_name === tableName && (item.action === "UPDATE" || item.action === "DELETE"))
          .toArray();
        const pendingMutationIds = new Set(pendingMutations.map(item => item.data[pk]));

        const safeDataToPut = data.filter((d: any) => !pendingMutationIds.has(d[pk]));

        await db.transaction('rw', table, async () => {
          if (safeIdsToDelete.length > 0) {
            await table.bulkDelete(safeIdsToDelete);
          }
          if (safeDataToPut.length > 0) {
            await table.bulkPut(safeDataToPut);
          }
        });
      } else if (data && data.length === 0) {
        // HOTFIX RECOVERY: Supabase is empty, DO NOT DELETE local data!
        // Instead, we act as a master node and PUSH our local data back up to Supabase to restore it.
        const table = (db as any)[tableName];
        const localItems = await table.toArray();
        
        if (localItems.length > 0) {
          console.warn(`[RECOVERY] Remote table ${tableName} is empty, but local has ${localItems.length} records. Pushing local data to restore remote...`);
          for (const item of localItems) {
            // Reformat mappings format on the fly if it's a lead or client_query
            if (tableName === 'leads' && item.business_name && typeof item.business_name === 'string') {
              if (item.business_name.includes('(@')) {
                // old format: Name (@Username) -> new format: [Username] - Name
                const match = item.business_name.match(/(.+) \(@(.+)\)/);
                if (match) {
                  item.business_name = `[${match[2]}] - ${match[1]}`;
                  if (item.contact_person === match[0]) item.contact_person = item.business_name;
                }
              }
            } else if (tableName === 'client_queries' && item.client_name && typeof item.client_name === 'string') {
               if (item.client_name.includes('(@')) {
                const match = item.client_name.match(/(.+) \(@(.+)\)/);
                if (match) {
                  item.client_name = `[${match[2]}] - ${match[1]}`;
                }
              }
            }

            // Queue an insert to push this local item back to Supabase
            await queueOfflineMutation(tableName, "INSERT", item);
          }
        }
      }
    }
    
    console.log("Downward sync complete.");
  } catch (err) {
    console.error("Failed to perform pull down sync:", err);
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// AUTO SYNC — online event + 60s periodic (Part 6)
// ─────────────────────────────────────────────────────────────────────────────

if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    console.log("Browser went online. Triggering sync...");
    processSyncQueue().catch(console.error);
    pullDownSync().catch(console.error);
  });

  // Part 6.2 — catch flaky connections that never fully drop
  setInterval(() => {
    if (navigator.onLine) {
      processSyncQueue().catch(console.error);
      pullDownSync().catch(console.error);
    }
  }, 60_000);
}

