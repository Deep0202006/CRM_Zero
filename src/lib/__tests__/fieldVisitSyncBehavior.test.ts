const mockVisit = {
  visit_id: "00000000-0000-4000-8000-000000000010",
  lead_id: "lead-1",
  user_id: "00000000-0000-4000-8000-000000000001",
  visit_date: "2026-07-31",
  check_in_time: "2026-07-31T04:00:00.000Z",
  check_in_lat: null,
  check_in_lng: null,
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
const mockRetryableRows = jest.fn(async () => [mockVisit]);
const mockMediaRows = jest.fn(async () => []);
const mockInsertSingle = jest.fn();
const mockMaybeSingle = jest.fn();

jest.mock("@/lib/db", () => ({
  db: {
    field_visits: {
      where: () => ({ anyOf: () => ({ toArray: mockRetryableRows }) }),
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
  supabase: {
    auth: {
      getUser: jest.fn(async () => ({
        data: { user: { id: mockVisit.user_id } },
        error: null,
      })),
    },
    storage: { from: jest.fn() },
    from: jest.fn(() => ({
      insert: () => ({ select: () => ({ single: mockInsertSingle }) }),
      select: () => ({
        eq: () => ({ eq: () => ({ maybeSingle: mockMaybeSingle }) }),
      }),
    })),
  },
}));

describe("field visit sync retry behavior", () => {
  beforeAll(() => {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { onLine: true },
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("confirms an already-inserted visit by owner after a unique conflict", async () => {
    mockInsertSingle.mockResolvedValue({
      data: null,
      error: { code: "23505", message: "duplicate key" },
    });
    mockMaybeSingle.mockResolvedValue({
      data: { visit_id: mockVisit.visit_id },
      error: null,
    });
    const { syncFieldVisits } = await import("@/lib/fieldVisits/sync");
    await syncFieldVisits();
    expect(mockMaybeSingle).toHaveBeenCalledTimes(1);
    expect(mockVisitUpdate).toHaveBeenCalledWith(
      mockVisit.visit_id,
      expect.objectContaining({ sync_status: "synced" }),
    );
  });

  it("retains evidence and marks failure when remote confirmation fails", async () => {
    mockMediaRows.mockResolvedValueOnce([]);
    mockInsertSingle.mockResolvedValue({
      data: null,
      error: { code: "42501", message: "denied" },
    });
    const { syncFieldVisits } = await import("@/lib/fieldVisits/sync");
    await syncFieldVisits();
    expect(mockMediaDelete).not.toHaveBeenCalled();
    expect(mockVisitUpdate).toHaveBeenCalledWith(mockVisit.visit_id, { sync_status: "sync_failed" });
  });
});
