jest.mock("server-only", () => ({}), { virtual: true });

import { buildImportPreview } from "@/lib/receivables/importServer";

const BUSINESS_NOW = new Date("2026-08-20T06:30:00.000Z");

function service() {
  const employeeId = "f2750ad8-f480-4d1d-b8a0-e00190534855";
  return {
    auth: { admin: { listUsers: jest.fn().mockResolvedValue({ data: { users: [{ id: employeeId, email: "zerodata_vaibhav@zerodata.local" }] }, error: null }) } },
    rpc: jest.fn().mockResolvedValue({ data: [{ row_number: 2, distributor_id: "40000000-0000-4000-a000-000000000001", distributor_name: "Alpha", distributor_reference: "ALPHA", resolution: "RESOLVED" }], error: null }),
    from(table:string) {
      const result = table === "users"
        ? { data: [{ user_id: employeeId, name: "Vaibhav Patel", email: "zerodata_vaibhav", is_active: true }], error: null }
        : table === "capability_definitions"
          ? { data: [], error: null }
          : { data: [], error: null };
      const builder:any={select:()=>builder,eq:()=>builder,order:()=>builder,range:()=>Promise.resolve(result),in:()=>Promise.resolve(result)};
      return builder;
    }
  } as never;
}

describe("employee directory time-dependent import coverage",()=>{
  beforeAll(()=>{jest.useFakeTimers();jest.setSystemTime(BUSINESS_NOW);});
  afterAll(()=>{jest.useRealTimers();});

  test("uses the frozen IST business date when assigning an operational employee",async()=>{
    const preview=await buildImportPreview(service(),"30000000-0000-4000-a000-000000000001",[{
      rowNumber:2,billReference:"INV-CLOCK",distributorName:"Alpha",distributorCode:"ALPHA",contactPerson:"Contact",contactPhone:"",billAmount:"100.00",billDueDate:"2026-08-20",nextFollowUpDate:"2026-08-20",assignedEmployeeEmail:"zerodata_vaibhav@zerodata.local",notes:""
    }]);
    expect(preview.rows[0]).toMatchObject({classification:"NEW",assigned_employee_name:"Vaibhav Patel",nextFollowUpDate:"2026-08-20"});
  });
});
