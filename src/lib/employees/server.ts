import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface EligibleEmployee {
  user_id: string;
  name: string;
  email: string;
}

const MAX_OPERATIONAL_EMPLOYEES = 500;

export async function listEligibleOperationalEmployees(service: SupabaseClient): Promise<{ employees: EligibleEmployee[]; error: unknown | null }> {
  const [users, adminCapabilities] = await Promise.all([
    service.from("users").select("user_id,name,email,is_active").eq("is_active", true).order("name").range(0, MAX_OPERATIONAL_EMPLOYEES),
    service.from("user_capabilities").select("user_id").eq("capability_code", "admin").range(0, MAX_OPERATIONAL_EMPLOYEES),
  ]);
  const error = users.error ?? adminCapabilities.error;
  if (error) return { employees: [], error };
  if ((users.data?.length ?? 0) > MAX_OPERATIONAL_EMPLOYEES || (adminCapabilities.data?.length ?? 0) > MAX_OPERATIONAL_EMPLOYEES) {
    return { employees: [], error: new Error("EMPLOYEE_DIRECTORY_LIMIT_EXCEEDED") };
  }
  const adminIds = new Set((adminCapabilities.data ?? []).map((row) => row.user_id));
  return {
    employees: (users.data ?? [])
      .filter((user) => (user.is_active === true || user.is_active === 1) && !adminIds.has(user.user_id))
      .map(({ user_id, name, email }) => ({ user_id, name, email })),
    error: null,
  };
}
