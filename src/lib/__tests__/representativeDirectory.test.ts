import { buildRepresentativeDirectory } from "@/lib/fieldVisits/representatives";

describe("field representative directory", () => {
  const users = [
    { user_id: "ret", name: "Retail Rep", email: "ret@example.test", is_active: true },
    { user_id: "dist", name: "Distributor Rep", email: "dist@example.test", is_active: true },
    { user_id: "historical", name: "Former Rep", email: "former@example.test", is_active: false },
    { user_id: "inactive-field", name: "Inactive Field", email: "inactive@example.test", is_active: false },
  ];
  const capabilities = [
    { user_id: "ret", capability_code: "field_ret" },
    { user_id: "dist", capability_code: "field_dist" },
    { user_id: "inactive-field", capability_code: "field_ret" },
  ];

  it("includes both active field employees even with zero visits", () => {
    const result = buildRepresentativeDirectory(users, capabilities, []);
    expect(result.map((row) => row.user_id)).toEqual(["dist", "ret", "inactive-field"]);
    expect(result.find((row) => row.user_id === "ret")?.capabilities).toEqual(["field_ret"]);
    expect(result.find((row) => row.user_id === "dist")?.capabilities).toEqual(["field_dist"]);
  });

  it("includes an inactive field-capability user and preserves the inactive label state", () => {
    expect(buildRepresentativeDirectory(users, capabilities, []).find((row) => row.user_id === "inactive-field")).toMatchObject({
      is_active: false,
      historical_only: false,
      capabilities: ["field_ret"],
    });
  });

  it("keeps an inactive historical representative without fabricating capabilities", () => {
    const result = buildRepresentativeDirectory(users, capabilities, ["historical"]);
    expect(result.find((row) => row.user_id === "historical")).toMatchObject({
      is_active: false,
      historical_only: true,
      capabilities: [],
    });
  });

  it("deduplicates users present in capabilities and visit history", () => {
    const result = buildRepresentativeDirectory(users, capabilities, ["ret", "ret"]);
    expect(result.filter((row) => row.user_id === "ret")).toHaveLength(1);
  });

  it("retains a historical UUID whose user row is unavailable", () => {
    const result = buildRepresentativeDirectory(users, capabilities, ["missing"]);
    expect(result.find((row) => row.user_id === "missing")).toMatchObject({
      user_missing: true,
      is_active: false,
      capabilities: [],
    });
  });
});
