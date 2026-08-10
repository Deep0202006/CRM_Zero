export interface ParsedCallClientReference {
  leadId: string | null;
  clientUsername: string | null;
  clientName: string | null;
  displayName: string;
}

const EXCEL_PREFIX = "EXCEL::";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isCallLeadId(value: unknown): boolean {
  return typeof value === "string" && UUID_PATTERN.test(value.trim());
}

export function parseCallClientReference(value: string): ParsedCallClientReference {
  const trimmed = value.trim();
  if (isCallLeadId(trimmed)) {
    return {
      leadId: trimmed,
      clientUsername: null,
      clientName: null,
      displayName: trimmed,
    };
  }

  if (!trimmed.startsWith(EXCEL_PREFIX)) {
    return {
      leadId: null,
      clientUsername: null,
      clientName: trimmed || null,
      displayName: trimmed || "Unknown client",
    };
  }

  const [, rawUsername = "", ...nameParts] = trimmed.split("::");
  const username = rawUsername.trim() || null;
  const name = nameParts.join("::").trim() || username || "Unknown client";

  return {
    leadId: null,
    clientUsername: username,
    clientName: name,
    displayName: username ? `${name} (@${username})` : name,
  };
}
