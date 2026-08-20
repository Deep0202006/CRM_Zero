import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface EligibleEmployee {
  user_id: string;
  name: string;
  email: string;
}

const MAX_OPERATIONAL_EMPLOYEES = 500;
const AUTH_PAGE_SIZE = 1000;
const MAX_AUTH_DIRECTORY_PAGES = 5;

export async function listEligibleOperationalEmployees(service: SupabaseClient): Promise<{ employees: EligibleEmployee[]; error: unknown | null }> {
  const excludedQuery = service
    .from("user_capabilities")
    .select("user_id,capability_code")
    .in("capability_code", ["admin", "erp_partner_viewer"]);
  const [users, excludedCapabilities] = await Promise.all([
    service.from("users").select("user_id,name,email,is_active").eq("is_active", true).order("name").range(0, MAX_OPERATIONAL_EMPLOYEES),
    typeof (excludedQuery as { range?: unknown }).range === "function"
      ? excludedQuery.range(0, MAX_OPERATIONAL_EMPLOYEES)
      : excludedQuery,
  ]);
  const error = users.error ?? excludedCapabilities.error;
  if (error) return { employees: [], error };
  if ((users.data?.length ?? 0) > MAX_OPERATIONAL_EMPLOYEES || (excludedCapabilities.data?.length ?? 0) > MAX_OPERATIONAL_EMPLOYEES) {
    return { employees: [], error: new Error("EMPLOYEE_DIRECTORY_LIMIT_EXCEEDED") };
  }
  const excludedIds = new Set((excludedCapabilities.data ?? []).map((row) => row.user_id));
  const operationalProfiles = (users.data ?? [])
    .filter((user) => (user.is_active === true || user.is_active === 1) && !excludedIds.has(user.user_id));
  const profilesById = new Map(operationalProfiles.map((user) => [String(user.user_id), user]));
  const authIdsByEmail = new Map<string, string>();
  const ambiguousEmails = new Set<string>();
  for (let page = 1; page <= MAX_AUTH_DIRECTORY_PAGES; page += 1) {
    const { data, error: authError } = await service.auth.admin.listUsers({ page, perPage: AUTH_PAGE_SIZE });
    if (authError) return { employees: [], error: authError };
    const authUsers = data.users ?? [];
    for (const authUser of authUsers) {
      if (!authUser.email || !profilesById.has(authUser.id)) continue;
      const email = authUser.email.trim().toLowerCase();
      if (authIdsByEmail.has(email) && authIdsByEmail.get(email) !== authUser.id) ambiguousEmails.add(email);
      else authIdsByEmail.set(email, authUser.id);
    }
    if (authUsers.length < AUTH_PAGE_SIZE) break;
    if (page === MAX_AUTH_DIRECTORY_PAGES) return { employees: [], error: new Error("AUTH_EMPLOYEE_DIRECTORY_LIMIT_EXCEEDED") };
  }
  return {
    employees: [...authIdsByEmail]
      .filter(([email]) => !ambiguousEmails.has(email))
      .flatMap(([email, userId]) => {
        const user = profilesById.get(userId);
        return user ? [{ user_id: String(user.user_id), name: String(user.name), email }] : [];
      }),
    error: null,
  };
}
