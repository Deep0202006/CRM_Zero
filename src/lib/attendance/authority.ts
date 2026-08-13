import { isValidISTDateKey } from "@/lib/dateTime";

export type AttendanceEvidenceState = "available" | "purged" | "legacy_or_system";

export interface AttendanceAuthorityRow {
  attendance_id: string;
  user_id: string;
  date: string;
  clock_in: string;
  clock_out?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  selfie_captured?: boolean | null;
  selfie_storage_path?: string | null;
  selfie_uploaded_at?: string | null;
  selfie_purged_at?: string | null;
  selfie_purge_state?: string | null;
}

export interface AttendanceDayResolution {
  present: boolean;
  attendance_ids: string[];
  clock_in: string | null;
  clock_out: string | null;
  has_location: boolean;
  evidence_state: AttendanceEvidenceState | null;
  duplicate_count: number;
}

export function attendanceEvidenceState(row: AttendanceAuthorityRow): AttendanceEvidenceState {
  if (row.selfie_purged_at || row.selfie_purge_state === "purged") return "purged";
  if (row.selfie_captured || row.selfie_storage_path) return "available";
  return "legacy_or_system";
}

export function resolveAttendanceDay(
  rows: AttendanceAuthorityRow[],
  userId: string,
  dateKey: string,
): AttendanceDayResolution {
  if (!isValidISTDateKey(dateKey)) throw new Error("Invalid India business date");
  const matches = rows
    .filter((row) => row.user_id === userId && row.date === dateKey)
    .sort((a, b) => a.clock_in.localeCompare(b.clock_in) || a.attendance_id.localeCompare(b.attendance_id));
  if (matches.length === 0) {
    return { present: false, attendance_ids: [], clock_in: null, clock_out: null, has_location: false, evidence_state: null, duplicate_count: 0 };
  }
  const clockOuts = matches.map((row) => row.clock_out).filter((value): value is string => Boolean(value)).sort();
  const evidence = matches.map(attendanceEvidenceState);
  return {
    present: true,
    attendance_ids: matches.map((row) => row.attendance_id),
    clock_in: matches[0].clock_in,
    clock_out: clockOuts.at(-1) ?? null,
    has_location: matches.some((row) => row.latitude != null && row.longitude != null),
    evidence_state: evidence.includes("available") ? "available" : evidence.includes("purged") ? "purged" : "legacy_or_system",
    duplicate_count: Math.max(0, matches.length - 1),
  };
}
