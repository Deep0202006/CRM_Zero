const mockVisit = {
  visit_id: "00000000-0000-4000-8000-000000000010",
  lead_id: "lead-1",
  user_id: "00000000-0000-4000-8000-000000000001",
  visit_date: "2026-07-31",
  check_in_time: "2026-07-31T04:00:00.000Z",
  check_in_lat: 1,
  check_in_lng: 1,
  check_in_photo_url: null,
  selfie_storage_path: null,
  visit_outcome: "interested",
  visit_notes: null,
  sync_status: "sync_failed",
  created_at: "2026-07-31T04:00:00.000Z",
  updated_at: "2026-07-31T04:00:00.000Z",
};

const mockVisitUpdate = jest.fn();
const mockMediaDelete = jest.fn();
const mockOwnRows = jest.fn(async () => [mockVisit]);
const mockMediaRows = jest.fn(async () => []);
const mockProcessSyncQueue = jest.fn(async () => undefined);

jest.mock("@/lib/db", () => ({
  processSyncQueue: mockProcessSyncQueue,
  db: {
    field_visits: {
      where: () => ({ equals: () => ({ toArray: mockOwnRows }) }),
      update: mockVisitUpdate,
    },
    field_visit_media: {
      where: () => ({ equals: () => ({ toArray: mockMediaRows }) }),
      delete: mockMediaDelete,
    },
  },
}));

jest.mock("@/lib/supabaseClient", () => ({
  isSupabaseConfigured: true,
  supabase: { auth: { getSession: jest.fn(async () => ({ data: { session: { access_token: "token", user: { id: mockVisit.user_id } } } })) } },
}));

describe("field visit server-confirmed sync behavior", () => {
  beforeAll(() => {
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { onLine: true } });
  });

  beforeEach(() => { jest.clearAllMocks(); });

  it("accepts an idempotent existing server confirmation", async () => {
    global.fetch = jest.fn(async () => ({
      json: async () => ({ ok: true, code: "VISIT_CONFIRMED", visit_id: mockVisit.visit_id, already_confirmed: true, evidence_confirmed: false }),
    })) as jest.Mock;
    const { syncFieldVisits } = await import("@/lib/fieldVisits/sync");
    const result = await syncFieldVisits();
    expect(result.alreadyConfirmed).toBe(1);
    expect(mockProcessSyncQueue).toHaveBeenCalled();
    expect(mockVisitUpdate).toHaveBeenCalledWith(mockVisit.visit_id, expect.objectContaining({ sync_status: "synced", sync_stage: "synced" }));
  });

  it("retains evidence and precise safe failure state when confirmation fails", async () => {
    global.fetch = jest.fn(async () => ({
      json: async () => ({ ok: false, code: "ATTENDANCE_NOT_CONFIRMED" }),
    })) as jest.Mock;
    const { syncFieldVisits } = await import("@/lib/fieldVisits/sync");
    const result = await syncFieldVisits();
    expect(result.failureCodes).toContain("ATTENDANCE_NOT_CONFIRMED");
    expect(mockMediaDelete).not.toHaveBeenCalled();
    expect(mockVisitUpdate).toHaveBeenCalledWith(mockVisit.visit_id, expect.objectContaining({ sync_status: "sync_failed", sync_error_code: "ATTENDANCE_NOT_CONFIRMED" }));
  });
});
