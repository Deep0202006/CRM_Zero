export interface ParsedCallClientReference {
  leadId: string | null;
  clientUsername: string | null;
  clientName: string | null;
  displayName: string;
}

const EXCEL_PREFIX = "EXCEL::";

export function parseCallClientReference(value: string): ParsedCallClientReference {
  const trimmed = value.trim();
  if (!trimmed.startsWith(EXCEL_PREFIX)) {
    return {
      leadId: trimmed || null,
      clientUsername: null,
      clientName: null,
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
