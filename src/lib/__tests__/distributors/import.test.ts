import { DISTRIBUTOR_IMPORT_HEADERS, parseDistributorTable } from "@/lib/distributors/import";

const headers = [...DISTRIBUTOR_IMPORT_HEADERS];
const valid = ["Shree Ganesh", "employee@example.com", "done", "13/08/2026", "done", "2026-08-13", "done", "2026-08-13", "active", "billed", "2026-08-13", "INV-1", "2027-08-13", "D-1"];

describe("Distributor Status import", () => {
  test("accepts mapping, renewal and independent billed/active facts", () => {
    const result = parseDistributorTable([headers, valid]);
    expect(result.invalid).toHaveLength(0);
    expect(result.rows[0]).toMatchObject({ mappingStatus: "done", mappedDate: "2026-08-13", activityStatus: "active", billingStatus: "billed", renewalDate: "2027-08-13" });
  });
  test.each([
    [["pending", "done", "pending"], /Training/],
    [["done", "pending", "done"], /Mapping/],
  ])("rejects invalid lifecycle combinations", ([installation, training, mapping], message) => {
    const row = [...valid]; row[2] = installation; row[4] = training; row[6] = mapping; row[7] = ""; row[8] = "not_applicable";
    const result = parseDistributorTable([headers, row]);
    expect(result.rows).toHaveLength(0); expect(result.invalid[0].reason).toMatch(message);
  });
  test("requires explicit mapping and rejects impossible dates", () => {
    const missing = [...valid]; missing[6] = "";
    expect(parseDistributorTable([headers, missing]).invalid[0].reason).toMatch(/Mapping Status/);
    const impossible = [...valid]; impossible[12] = "2026-02-30";
    expect(parseDistributorTable([headers, impossible]).invalid).toHaveLength(1);
  });
  test("rejects duplicate headers", () => expect(() => parseDistributorTable([[...headers.slice(0, -1), "Distributor Name"]])).toThrow(/Duplicate/));
});
