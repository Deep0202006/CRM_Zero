import { isCallLeadId, parseCallClientReference } from "./callLogs/contract";

export interface PreparedSyncPayload {
  data: Record<string, unknown>;
  changed: boolean;
  repairReason?: string;
  queueSchemaVersion?: number;
  supported?: boolean;
}

export const ATTENDANCE_QUEUE_SCHEMA_VERSION = 2;
export const LEGACY_ATTENDANCE_QUEUE_SCHEMA_VERSION = 1;

function asRecord(value: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value));
}

function nonEmptyText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

const ATTENDANCE_TRANSPORT_METADATA = [
  "selfie_captured",
  "selfie_storage_path",
  "selfie_uploaded_at",
  "selfie_purged_at",
  "selfie_purge_state",
  "selfie_purge_started_at",
] as const;

/** Removes only locally-derived evidence lifecycle metadata from an attendance command. */
export function normalizeAttendanceConfirmationPayload(value: object): PreparedSyncPayload {
  const data = asRecord(value);
  const removed = ATTENDANCE_TRANSPORT_METADATA.filter((key) => Object.prototype.hasOwnProperty.call(data, key));
  for (const key of removed) delete data[key];
  return { data, changed: removed.length > 0, ...(removed.length ? { repairReason: "removed local attendance evidence metadata" } : {}) };
}

export function serializeAttendanceQueuePayload(value: object, evidence: Blob | null): Record<string, unknown> {
  const normalized = normalizeAttendanceConfirmationPayload(value);
  return { ...normalized.data, selfie_url: null, selfie_blob: evidence };
}

export function parseAttendanceQueueSchemaVersion(value: FormDataEntryValue | null): number | null {
  if (value === null) return LEGACY_ATTENDANCE_QUEUE_SCHEMA_VERSION;
  if (value === String(LEGACY_ATTENDANCE_QUEUE_SCHEMA_VERSION)) return LEGACY_ATTENDANCE_QUEUE_SCHEMA_VERSION;
  if (value === String(ATTENDANCE_QUEUE_SCHEMA_VERSION)) return ATTENDANCE_QUEUE_SCHEMA_VERSION;
  return null;
}

/**
 * Repairs legacy offline payloads before they are sent to Supabase.
 *
 * Older Call Activity builds stored Excel-directory references in UUID foreign-key
 * fields (for example `EXCEL::username::Name`). Those rows could live in IndexedDB
 * while every remote insert failed. The repair is deterministic and preserves the
 * human-readable client identity in dedicated text columns.
 */
export function prepareSyncPayload(tableName: string, value: object, queueSchemaVersion?: number): PreparedSyncPayload {
  if (tableName === "attendance") {
    const sourceVersion = queueSchemaVersion ?? LEGACY_ATTENDANCE_QUEUE_SCHEMA_VERSION;
    if (![LEGACY_ATTENDANCE_QUEUE_SCHEMA_VERSION, ATTENDANCE_QUEUE_SCHEMA_VERSION].includes(sourceVersion)) {
      return { data: asRecord(value), changed: false, queueSchemaVersion: sourceVersion, supported: false };
    }
    const normalized = normalizeAttendanceConfirmationPayload(value);
    const upgraded = sourceVersion !== ATTENDANCE_QUEUE_SCHEMA_VERSION;
    return {
      ...normalized,
      changed: normalized.changed || upgraded,
      queueSchemaVersion: ATTENDANCE_QUEUE_SCHEMA_VERSION,
      supported: true,
      ...((normalized.changed || upgraded) ? { repairReason: upgraded ? "upgraded legacy attendance queue schema" : normalized.repairReason } : {}),
    };
  }
  const data = asRecord(value);
  let changed = false;
  const reasons: string[] = [];

  if (tableName === "call_logs") {
    const legacyLeadId = typeof data.lead_id === "string" ? data.lead_id : null;
    if (legacyLeadId && !isCallLeadId(legacyLeadId)) {
      const parsed = parseCallClientReference(legacyLeadId);
      data.lead_id = null;
      data.client_username = nonEmptyText(data.client_username) ?? parsed.clientUsername;
      data.client_name = nonEmptyText(data.client_name) ?? parsed.clientName ?? legacyLeadId.trim();
      changed = true;
      reasons.push(legacyLeadId.startsWith("EXCEL::")
        ? "converted legacy Excel client reference"
        : "converted legacy custom client reference");
    }
  }

  if (tableName === "tasks") {
    const relatedLeadId = typeof data.related_lead_id === "string" ? data.related_lead_id : null;
    if (relatedLeadId?.startsWith("EXCEL::")) {
      data.related_lead_id = null;
      changed = true;
      reasons.push("removed legacy non-UUID related lead reference");
    }
  }

  return {
    data,
    changed,
    ...(reasons.length > 0 ? { repairReason: reasons.join("; ") } : {}),
  };
}
