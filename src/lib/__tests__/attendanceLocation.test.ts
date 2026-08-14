import { captureAttendanceLocation } from "@/lib/attendance/location";
import fs from "node:fs";
import path from "node:path";

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");

describe("field Attendance location contract", () => {
  test("captures the exact browser coordinates with high-accuracy bounded acquisition", async () => {
    let options: PositionOptions | undefined;
    const geolocation = {
      getCurrentPosition(success: PositionCallback, _error?: PositionErrorCallback | null, received?: PositionOptions) {
        options = received;
        success({ coords: { latitude: 18.5204, longitude: 73.8567 } } as GeolocationPosition);
      },
    } as Geolocation;
    await expect(captureAttendanceLocation(geolocation)).resolves.toEqual({ latitude: 18.5204, longitude: 73.8567 });
    expect(options).toEqual({ enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 });
  });

  test("does not queue field Attendance when location acquisition fails", async () => {
    const geolocation = {
      getCurrentPosition(_success: PositionCallback, error?: PositionErrorCallback | null) {
        error?.({ code: 1, message: "denied", PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as GeolocationPositionError);
      },
    } as Geolocation;
    await expect(captureAttendanceLocation(geolocation)).rejects.toThrow("ATTENDANCE_LOCATION_UNAVAILABLE");
    const page = read("src/app/attendance/page.tsx");
    const clockIn = page.slice(page.indexOf("const handleClockIn"));
    expect(clockIn.indexOf("captureAttendanceLocation")).toBeLessThan(clockIn.indexOf("saveAttendanceWithEvidence"));
    const route = read("src/app/api/attendance/confirm/route.ts");
    expect(route).toContain("ATTENDANCE_LOCATION_REQUIRED");
  });
});
