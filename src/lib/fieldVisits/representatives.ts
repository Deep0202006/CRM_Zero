export interface RepresentativeUserRecord {
  user_id: string;
  name: string;
  email: string;
  is_active: boolean | number | string;
}

export interface RepresentativeCapabilityRecord {
  user_id: string;
  capability_code: string;
}

export interface RepresentativeDirectoryRow {
  user_id: string;
  name: string;
  email: string;
  is_active: boolean;
  capabilities: string[];
  historical_only: boolean;
  user_missing: boolean;
}

const FIELD_CAPABILITIES = new Set(["field_ret", "field_dist"]);

function isActive(value: RepresentativeUserRecord["is_active"]): boolean {
  return value === true || value === 1 || value === "1" || value === "true";
}

export function buildRepresentativeDirectory(
  users: RepresentativeUserRecord[],
  capabilities: RepresentativeCapabilityRecord[],
  historicalVisitUserIds: string[],
): RepresentativeDirectoryRow[] {
  const usersById = new Map(users.map((user) => [user.user_id, user]));
  const capabilitiesByUser = new Map<string, string[]>();
  for (const assignment of capabilities) {
    const current = capabilitiesByUser.get(assignment.user_id) ?? [];
    if (!current.includes(assignment.capability_code)) current.push(assignment.capability_code);
    capabilitiesByUser.set(assignment.user_id, current.sort());
  }

  const activeFieldUserIds = users
    .filter((user) => isActive(user.is_active))
    .filter((user) => (capabilitiesByUser.get(user.user_id) ?? []).some((code) => FIELD_CAPABILITIES.has(code)))
    .map((user) => user.user_id);
  const historicalIds = new Set(historicalVisitUserIds);
  const directoryIds = new Set([...activeFieldUserIds, ...historicalIds]);

  return [...directoryIds]
    .map((userId): RepresentativeDirectoryRow => {
      const user = usersById.get(userId);
      const fieldCapabilities = (capabilitiesByUser.get(userId) ?? [])
        .filter((code) => FIELD_CAPABILITIES.has(code));
      return {
        user_id: userId,
        name: user?.name ?? "Unavailable representative",
        email: user?.email ?? "",
        is_active: user ? isActive(user.is_active) : false,
        capabilities: fieldCapabilities,
        historical_only: !fieldCapabilities.length,
        user_missing: !user,
      };
    })
    .sort(
      (a, b) =>
        Number(b.is_active) - Number(a.is_active) ||
        a.name.localeCompare(b.name) ||
        a.user_id.localeCompare(b.user_id),
    );
}
