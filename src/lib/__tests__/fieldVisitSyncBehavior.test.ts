import type { LocalFieldVisit } from "@/lib/db";

const mockVisit: LocalFieldVisit = {
  visit_id: "00000000-0000-4000-8000-000000000010",
  lead_id: "lead-1",
  user_id: "00000000-0000-4000-8000-000000000001",
  visit_date: "2026-07-31",
  check_in_time: "2026-07-31T04:00:00.000Z",
  check_in_lat: 1,
  check_in_lng: 1,
  address: "Main Road",
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
      get: jest.fn(async () => mockVisit),
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
      status: 400,
      json: async () => ({ ok: false, code: "ATTENDANCE_NOT_CONFIRMED" }),
    })) as jest.Mock;
    const { syncFieldVisits } = await import("@/lib/fieldVisits/sync");
    const result = await syncFieldVisits();
    expect(result.failureCodes).toContain("ATTENDANCE_NOT_CONFIRMED");
    expect(mockMediaDelete).not.toHaveBeenCalled();
    expect(mockVisitUpdate).toHaveBeenCalledWith(mockVisit.visit_id, expect.objectContaining({ sync_status: "sync_failed", sync_stage: "review_required", sync_error_code: "ATTENDANCE_NOT_CONFIRMED", next_sync_attempt_at: undefined }));
  });

  it("stops automatic replay after a terminal 400", async () => {
    mockOwnRows.mockResolvedValueOnce([{ ...mockVisit, sync_stage: "review_required" }]);
    global.fetch = jest.fn();
    const { syncFieldVisits } = await import("@/lib/fieldVisits/sync");
    const result = await syncFieldVisits();
    expect(result.locallyFound).toBe(0);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it.each([408, 429, 500, 503])("backs off transient HTTP %s", async (status) => {
    global.fetch = jest.fn(async () => ({
      status,
      json: async () => ({ ok: false, code: "VISIT_CONFIRMATION_FAILED" }),
    })) as jest.Mock;
    const { syncFieldVisits } = await import("@/lib/fieldVisits/sync");
    await syncFieldVisits();
    expect(mockVisitUpdate).toHaveBeenCalledWith(mockVisit.visit_id, expect.objectContaining({ sync_stage: "sync_failed", next_sync_attempt_at: expect.any(String) }));
  });

  it("stops a transient response after the bounded attempt limit", async () => {
    mockOwnRows.mockResolvedValueOnce([{ ...mockVisit, sync_attempt_count: 4 }]);
    (mockVisit as typeof mockVisit & { sync_attempt_count?: number }).sync_attempt_count = 5;
    global.fetch = jest.fn(async () => ({
      status: 503,
      json: async () => ({ ok: false, code: "VISIT_CONFIRMATION_FAILED" }),
    })) as jest.Mock;
    const { syncFieldVisits } = await import("@/lib/fieldVisits/sync");
    await syncFieldVisits();
    expect(mockVisitUpdate).toHaveBeenCalledWith(mockVisit.visit_id, expect.objectContaining({ sync_stage: "review_required", next_sync_attempt_at: undefined }));
    delete (mockVisit as typeof mockVisit & { sync_attempt_count?: number }).sync_attempt_count;
  });

  it("uses recovery semantics for a queued new-mode payload", async () => {
    mockOwnRows.mockResolvedValueOnce([{ ...mockVisit, confirmation_mode: "new" }]);
    global.fetch = jest.fn(async (_url, init) => {
      expect((init?.body as FormData).get("mode")).toBe("recovery");
      return { status: 200, json: async () => ({ ok: true, code: "VISIT_CONFIRMED", visit_id: mockVisit.visit_id, evidence_confirmed: false }) };
    }) as jest.Mock;
    const { syncFieldVisits } = await import("@/lib/fieldVisits/sync");
    await syncFieldVisits(undefined, mockVisit.user_id, "recovery");
  });
});
