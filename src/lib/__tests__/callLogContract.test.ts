import { parseCallClientReference } from "../callLogs/contract";

describe("call client reference contract", () => {
  it("keeps a CRM lead UUID as the lead foreign key", () => {
    expect(parseCallClientReference("00000000-0000-4000-8000-000000000001")).toEqual({
      leadId: "00000000-0000-4000-8000-000000000001",
      clientUsername: null,
      clientName: null,
      displayName: "00000000-0000-4000-8000-000000000001",
    });
  });

  it("moves an Excel-directory identity out of the UUID field", () => {
    expect(parseCallClientReference("EXCEL::retailer01::Retailer One")).toEqual({
      leadId: null,
      clientUsername: "retailer01",
      clientName: "Retailer One",
      displayName: "Retailer One (@retailer01)",
    });
  });

  it("keeps a free-text client as human identity instead of a lead foreign key", () => {
    expect(parseCallClientReference("  New Horizon Party  ")).toEqual({
      leadId: null,
      clientUsername: null,
      clientName: "New Horizon Party",
      displayName: "New Horizon Party",
    });
  });
});
