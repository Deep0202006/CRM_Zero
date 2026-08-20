import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  normalizeErpKey,
  normalizeErpName,
  stableErpId,
  type ErpSystem,
} from "./domain";

const MAX_ERP_SYSTEMS = 500;

export async function listErpSystems(
  service: SupabaseClient,
): Promise<ErpSystem[]> {
  const { data, error } = await service
    .from("erp_systems")
    .select("erp_id,erp_name,erp_key")
    .order("erp_name")
    .range(0, MAX_ERP_SYSTEMS);
  if (error) throw error;
  if ((data?.length ?? 0) > MAX_ERP_SYSTEMS)
    throw new Error("ERP_DIRECTORY_LIMIT_EXCEEDED");
  return (data ?? []) as ErpSystem[];
}

export async function resolveErpNames(
  service: SupabaseClient,
  values: string[],
): Promise<Map<string, ErpSystem & { isNew: boolean }>> {
  const names = [
    ...new Map(
      values
        .map(normalizeErpName)
        .filter(Boolean)
        .map((name) => [normalizeErpKey(name), name]),
    ).entries(),
  ];
  const result = new Map<string, ErpSystem & { isNew: boolean }>();
  for (let offset = 0; offset < names.length; offset += 100) {
    const chunk = names.slice(offset, offset + 100);
    const { data, error } = await service
      .from("erp_systems")
      .select("erp_id,erp_name,erp_key")
      .in(
        "erp_key",
        chunk.map(([key]) => key),
      );
    if (error) throw error;
    for (const row of data ?? [])
      result.set(String(row.erp_key), { ...(row as ErpSystem), isNew: false });
  }
  for (const [key, name] of names) {
    if (!result.has(key))
      result.set(key, {
        erp_id: stableErpId(name),
        erp_name: name,
        erp_key: key,
        isNew: true,
      });
  }
  return result;
}
