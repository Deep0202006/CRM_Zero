const BUSINESS_NOW = new Date("2026-08-20T06:30:00.000Z");
let clockFrozen = false;
beforeAll(() => {
  if ((expect.getState().testPath?.replace(/\\/g, "/") ?? "").endsWith("/employeesDirectory.test.ts")) {
    jest.useFakeTimers(); jest.setSystemTime(BUSINESS_NOW); clockFrozen = true;
  }
});
afterAll(() => { if (clockFrozen) jest.useRealTimers(); });
