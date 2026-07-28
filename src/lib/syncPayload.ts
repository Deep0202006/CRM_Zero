import { parseCallClientReference } from "./callLogs/contract";

export interface PreparedSyncPayload {
  data: Record<string, unknown>;
  changed: boolean;
  repairReason?: string;
}

function asRecord(value: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value));
}

/**
 * Repairs legacy offline payloads before they are sent to Supabase.
 *
 * Older Call Activity builds stored Excel-directory references in UUID foreign-key
 * fields (for example `EXCEL::username::Name`). Those rows could live in IndexedDB
 * while every remote insert failed. The repair is deterministic and preserves the
 * human-readable client identity in dedicated text columns.
 */
export function prepareSyncPayload(tableName: string, value: object): PreparedSyncPayload {
  const data = asRecord(value);
  let changed = false;
  const reasons: string[] = [];

  if (tableName === "call_logs") {
    const legacyLeadId = typeof data.lead_id === "string" ? data.lead_id : null;
    if (legacyLeadId?.startsWith("EXCEL::")) {
      const parsed = parseCallClientReference(legacyLeadId);
      data.lead_id = null;
      data.client_username = data.client_username ?? parsed.clientUsername;
      data.client_name = data.client_name ?? parsed.clientName;
      changed = true;
      reasons.push("converted legacy Excel client reference");
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
