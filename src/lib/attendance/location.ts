export interface AttendanceLocation {
  latitude: number;
  longitude: number;
}

const LOCATION_TIMEOUT_MS = 15_000;

export function captureAttendanceLocation(geolocation: Geolocation): Promise<AttendanceLocation> {
  return new Promise((resolve, reject) => {
    geolocation.getCurrentPosition(
      (position) => resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude }),
      () => reject(new Error("ATTENDANCE_LOCATION_UNAVAILABLE")),
      { enableHighAccuracy: true, timeout: LOCATION_TIMEOUT_MS, maximumAge: 0 },
    );
  });
}
