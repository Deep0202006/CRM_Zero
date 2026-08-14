import type { SupabaseClient } from "@supabase/supabase-js";
import { purgeExpiredSelfies } from "@/lib/fieldVisits/retention";

type EvidenceRow = {
  attendance_id: string;
  user_id: string;
  date: string;
  selfie_storage_path: string;
  selfie_uploaded_at: string;
  selfie_purged_at: string | null;
  selfie_purge_state: string | null;
  selfie_purge_started_at: string | null;
};

function retentionClient(options: { failStorageOnce?: boolean; failMetadataOnce?: boolean } = {}) {
  const row: EvidenceRow = {
    attendance_id: "10000000-0000-4000-a000-000000000001",
    user_id: "20000000-0000-4000-a000-000000000001",
    date: "2026-08-01",
    selfie_storage_path: "attendance/20000000-0000-4000-a000-000000000001/2026-08-01/10000000-0000-4000-a000-000000000001.jpg",
    selfie_uploaded_at: "2026-08-01T04:00:00.000Z",
    selfie_purged_at: null,
    selfie_purge_state: "available",
    selfie_purge_started_at: null,
  };
  const removedPaths: string[] = [];
  let storageFailures = options.failStorageOnce ? 1 : 0;
  let metadataFailures = options.failMetadataOnce ? 1 : 0;

  function candidateQuery(table: string) {
    const query = {
      not: () => query,
      is: () => query,
      lte: () => query,
      order: () => query,
      limit: async () => ({ data: table === "attendance" && row.selfie_purged_at === null ? [row] : [], error: null }),
    };
    return query;
  }

  function updateQuery(table: string, patch: Record<string, unknown>) {
    const query = {
      eq: () => query,
      is: () => query,
      or: () => query,
      select: () => query,
      maybeSingle: async () => {
        if (table !== "attendance") return { data: null, error: null };
        if (patch.selfie_purge_state === "purge_pending") {
          const nextStarted = String(patch.selfie_purge_started_at);
          const stale = !row.selfie_purge_started_at || Date.parse(row.selfie_purge_started_at) < Date.parse(nextStarted) - 60 * 60 * 1000;
          if (row.selfie_purge_state === "purge_pending" && !stale) return { data: null, error: null };
          Object.assign(row, patch);
          return { data: { attendance_id: row.attendance_id }, error: null };
        }
        if (metadataFailures > 0) {
          metadataFailures--;
          return { data: null, error: { code: "TEST_METADATA_FAILURE" } };
        }
        Object.assign(row, patch);
        return { data: { attendance_id: row.attendance_id }, error: null };
      },
    };
    return query;
  }

  const client = {
    from: (table: string) => ({
      select: () => candidateQuery(table),
      update: (patch: Record<string, unknown>) => updateQuery(table, patch),
    }),
    storage: {
      from: (bucket: string) => ({
        remove: async (paths: string[]) => {
          expect(bucket).toBe("visits-evidence");
          removedPaths.push(...paths);
          if (storageFailures > 0) {
            storageFailures--;
            return { data: null, error: { message: "temporary failure" } };
          }
          return { data: [], error: null };
        },
      }),
    },
  } as unknown as SupabaseClient;

  return { client, row, removedPaths };
}

describe("Attendance selfie retention recovery", () => {
  const firstRun = new Date("2026-08-10T06:00:00.000Z");
  const retryRun = new Date("2026-08-10T08:00:00.000Z");

  test("reconciles a missing object after Storage succeeded but metadata marking failed", async () => {
    const state = retentionClient({ failMetadataOnce: true });
    await expect(purgeExpiredSelfies(state.client, firstRun)).resolves.toMatchObject({ deleted: 0, failed: 1, attendancePurged: 0 });
    expect(state.row.selfie_purge_state).toBe("purge_pending");
    await expect(purgeExpiredSelfies(state.client, retryRun)).resolves.toMatchObject({ deleted: 1, failed: 0, attendancePurged: 1 });
    expect(state.row.selfie_purge_state).toBe("purged");
    expect(state.row.selfie_purged_at).toBe(retryRun.toISOString());
    expect(state.removedPaths).toEqual([state.row.selfie_storage_path, state.row.selfie_storage_path]);
    expect(state.row.attendance_id).toBe("10000000-0000-4000-a000-000000000001");
  });

  test("retries a Storage API failure after the bounded stale-claim interval", async () => {
    const state = retentionClient({ failStorageOnce: true });
    await expect(purgeExpiredSelfies(state.client, firstRun)).resolves.toMatchObject({ deleted: 0, failed: 1 });
    expect(state.row.selfie_purged_at).toBeNull();
    await expect(purgeExpiredSelfies(state.client, retryRun)).resolves.toMatchObject({ deleted: 1, failed: 0 });
    expect(state.row.selfie_purge_state).toBe("purged");
  });
});
