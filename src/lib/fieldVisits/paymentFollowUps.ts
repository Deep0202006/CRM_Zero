import excelUsers from "@/lib/excel_users.json";

export const PAYMENT_FOLLOW_UP_OUTCOME = "payment_follow_up" as const;

export interface PaymentFollowUpVisitSource {
  visit_id: string;
  lead_id: string;
  follow_up_date?: string | null;
}

export interface PaymentFollowUpIdentity {
  visit_id: string;
  follow_up_date: string;
  username: string;
  party_name: string;
  visit_outcome: typeof PAYMENT_FOLLOW_UP_OUTCOME;
}

interface LeadIdentitySource {
  lead_id: string;
  business_name: string | null;
}

interface DirectoryEntry {
  username: string;
  name?: string | null;
}

const directory = excelUsers as DirectoryEntry[];
const normalize = (value: string | null | undefined) => value?.trim().toLocaleLowerCase("en-IN").replace(/\s+/g, " ") ?? "";
const usernameByKey = new Map(directory.map((entry) => [normalize(entry.username), entry]));
const entriesByName = new Map<string, DirectoryEntry[]>();
for (const entry of directory) {
  const key = normalize(entry.name);
  const matches = entriesByName.get(key) ?? [];
  matches.push(entry);
  entriesByName.set(key, matches);
}

function parseEncodedIdentity(value: string | null | undefined): { party: string; username: string } | null {
  const match = value?.trim().match(/^(.*?)\s*\(@([^)]+)\)\s*$/);
  if (!match) return null;
  return { party: match[1].trim(), username: match[2].trim() };
}

function exactDirectoryMatch(value: string | null | undefined): DirectoryEntry | null {
  const usernameMatch = usernameByKey.get(normalize(value));
  if (usernameMatch) return usernameMatch;
  const nameMatches = entriesByName.get(normalize(value)) ?? [];
  return nameMatches.length === 1 ? nameMatches[0] : null;
}

export function resolvePaymentFollowUpIdentity(
  visit: PaymentFollowUpVisitSource,
  lead: LeadIdentitySource | null,
): PaymentFollowUpIdentity | null {
  if (!visit.follow_up_date) return null;
  const storedIdentity = parseEncodedIdentity(visit.lead_id);
  const leadIdentity = parseEncodedIdentity(lead?.business_name);
  const directoryMatch =
    exactDirectoryMatch(visit.lead_id) ??
    exactDirectoryMatch(lead?.business_name);

  const username =
    usernameByKey.get(normalize(visit.lead_id))?.username ??
    storedIdentity?.username ??
    leadIdentity?.username ??
    directoryMatch?.username ??
    "Username unavailable";
  const partyName =
    leadIdentity?.party ??
    lead?.business_name?.trim() ??
    storedIdentity?.party ??
    directoryMatch?.name?.trim() ??
    "Party unavailable";

  return {
    visit_id: visit.visit_id,
    follow_up_date: visit.follow_up_date,
    username,
    party_name: partyName,
    visit_outcome: PAYMENT_FOLLOW_UP_OUTCOME,
  };
}

export function mergePaymentFollowUps(
  userId: string,
  currentDate: string,
  remote: PaymentFollowUpIdentity[],
  local: Array<PaymentFollowUpVisitSource & { user_id: string; segment_type?: string | null; visit_outcome: string; sync_status?: string; lead?: LeadIdentitySource | null }>,
): PaymentFollowUpIdentity[] {
  const merged = new Map(remote.map((item) => [item.visit_id, item]));
  for (const visit of local) {
    if (
      visit.user_id !== userId ||
      visit.segment_type !== "Distributor" ||
      visit.visit_outcome !== PAYMENT_FOLLOW_UP_OUTCOME ||
      visit.follow_up_date !== currentDate ||
      !["pending_sync", "sync_failed"].includes(visit.sync_status ?? "")
    ) continue;
    const resolved = resolvePaymentFollowUpIdentity(visit, visit.lead ?? null);
    if (resolved && !merged.has(resolved.visit_id)) merged.set(resolved.visit_id, resolved);
  }
  return [...merged.values()];
}
