const BUSINESS_NOW = new Date("2026-08-20T06:30:00.000Z");
let clockFrozen = false;

beforeAll(() => {
  const testPath = expect.getState().testPath?.replace(/\\/g,"/") ?? "";
  if (testPath.endsWith("/employeesDirectory.test.ts")) {
    jest.useFakeTimers();
    jest.setSystemTime(BUSINESS_NOW);
    clockFrozen = true;
  }
});

afterAll(() => {
  if (clockFrozen) jest.useRealTimers();
});
