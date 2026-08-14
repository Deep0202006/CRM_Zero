"use client";

import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/context/AuthContext";
import { confirmQueuedAttendance, db, saveAttendanceWithEvidence, LocalAttendance } from "@/lib/db";
import { supabase } from "@/lib/supabaseClient";
import {
  Camera,
  CheckCircle,
  ShieldAlert,
  Clock,
  AlertCircle,
  LogIn,
  ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { getCurrentISTDate } from "@/lib/dateTime";
import { captureAttendanceLocation, type AttendanceLocation } from "@/lib/attendance/location";

function formatISTDateKey(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return `${weekdays[date.getUTCDay()]} ${day} ${months[month - 1]}, ${year}`;
}

export default function AttendancePage() {
  const { currentUser, isFieldStaff, isOfficeStaff, isAdmin } = useAuth();

  const [todayRecord, setTodayRecord] = useState<LocalAttendance | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [confirmationState, setConfirmationState] = useState<"confirmed" | "pending" | "review_required" | "unavailable">("unavailable");
  const [authoritativeMode, setAuthoritativeMode] = useState<"field_selfie" | "office_auto" | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [streamActive, setStreamActive] = useState(false);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);

  const todayStr = getCurrentISTDate();
  const requiresFieldEvidence = authoritativeMode === "field_selfie" || (authoritativeMode === null && isFieldStaff);
  const usesOfficeAttendance = authoritativeMode === "office_auto" || (authoritativeMode === null && isOfficeStaff);

  const loadTodayRecord = async () => {
    if (!currentUser) return;
    try {
      const records = await db.attendance.where("user_id").equals(currentUser.user_id).toArray();
      const local = records.find((record) => record.date === todayStr);
      const queued = local ? await db.sync_queue.where("idempotency_key").equals(`attendance:${local.attendance_id}`).first() : null;
      if (navigator.onLine) {
        const { data } = await supabase.auth.getSession();
        if (data.session?.access_token) {
          const response = await fetch(`/api/attendance/mine?date=${todayStr}`, { headers: { Authorization: `Bearer ${data.session.access_token}` }, cache: "no-store" });
          if (response.ok) {
            const result = await response.json() as { mode?: "field_selfie" | "office_auto"; attendance?: LocalAttendance[] };
            if (result.mode === "field_selfie" || result.mode === "office_auto") setAuthoritativeMode(result.mode);
            const authoritative = result.attendance?.[0] ?? null;
            if (authoritative) {
              await db.attendance.put(authoritative);
              setTodayRecord(authoritative);
              setCapturedImage(null);
              setConfirmationState("confirmed");
              return;
            }
          }
        }
      }
      if (local && queued) {
        setTodayRecord(local);
        setCapturedImage(local.selfie_url ?? null);
        setConfirmationState(queued.recovery_state === "review_required" ? "review_required" : "pending");
      } else {
        setTodayRecord(null);
        setConfirmationState("unavailable");
      }
    } catch (err) {
      console.error("Failed to query attendance record", err);
    }
  };

  useEffect(() => {
    loadTodayRecord();
  }, [currentUser]);

  useEffect(() => {
    const confirmed = (event: Event) => {
      const attendance = (event as CustomEvent<LocalAttendance>).detail;
      if (!attendance || attendance.user_id !== currentUser?.user_id || attendance.date !== todayStr) return;
      setTodayRecord(attendance);
      setConfirmationState("confirmed");
      setSuccessMsg("Attendance confirmed by the server.");
      window.setTimeout(() => { window.location.href = "/my-day"; }, 1400);
    };
    window.addEventListener("zerodata:attendance-confirmed", confirmed);
    return () => window.removeEventListener("zerodata:attendance-confirmed", confirmed);
  }, [currentUser?.user_id, todayStr]);

  const initCamera = async () => {
    if (!requiresFieldEvidence || todayRecord) return;
    setErrorMsg(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 480 }, height: { ideal: 480 } },
        audio: false,
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setStreamActive(true);
      }
    } catch (err) {
      setErrorMsg("Camera access denied. Please allow camera permissions.");
    }
  };

  useEffect(() => {
    if (requiresFieldEvidence && !todayRecord && currentUser) initCamera();
    return () => {
      if (videoRef.current?.srcObject) {
        (videoRef.current.srcObject as MediaStream).getTracks().forEach((t) => t.stop());
      }
    };
  }, [requiresFieldEvidence, todayRecord, currentUser]);

  const captureSelfie = async (): Promise<Blob | null> => {
    if (!videoRef.current || !canvasRef.current) return null;
    const ctx = canvasRef.current.getContext("2d");
    if (!ctx) return null;
    canvasRef.current.width = videoRef.current.videoWidth || 480;
    canvasRef.current.height = videoRef.current.videoHeight || 480;
    ctx.drawImage(videoRef.current, 0, 0);
    return new Promise((resolve) => canvasRef.current?.toBlob(resolve, "image/jpeg", 0.7));
  };

  const handleClockIn = async () => {
    if (!currentUser) return;
    setIsLoading(true);
    setErrorMsg(null);

    let selfieBlob: Blob | null = null;
    let location: AttendanceLocation | null = null;

    if (requiresFieldEvidence) {
      selfieBlob = await captureSelfie();
      if (!selfieBlob) {
        setErrorMsg("Could not capture selfie. Please allow camera access and try again.");
        setIsLoading(false);
        return;
      }
      if (!navigator.geolocation) {
        setErrorMsg("Location is required for field attendance. Enable location services and try again.");
        setIsLoading(false);
        return;
      }
      try {
        location = await captureAttendanceLocation(navigator.geolocation);
      } catch {
        setErrorMsg("Could not capture your location. Enable precise location access and try again.");
        setIsLoading(false);
        return;
      }
      if (videoRef.current?.srcObject) {
        (videoRef.current.srcObject as MediaStream).getTracks().forEach((t) => t.stop());
        setStreamActive(false);
      }
    }

    try {
      const newAttendance: LocalAttendance = {
        attendance_id: crypto.randomUUID(),
        user_id: currentUser.user_id,
        date: todayStr,
        clock_in: new Date().toISOString(),
        clock_out: null,
        selfie_url: null,
        selfie_captured: Boolean(selfieBlob),
        latitude: location?.latitude ?? null,
        longitude: location?.longitude ?? null,
      };

      await saveAttendanceWithEvidence(newAttendance, selfieBlob);
      const confirmation = await confirmQueuedAttendance(newAttendance.attendance_id);
      setTodayRecord(confirmation.attendance ?? newAttendance);
      setConfirmationState(confirmation.status);
      if (selfieBlob) setCapturedImage(URL.createObjectURL(selfieBlob));
      if (confirmation.status === "confirmed") {
        setSuccessMsg(requiresFieldEvidence ? "Attendance confirmed with selfie." : "Attendance confirmed.");
        setTimeout(() => { window.location.href = "/my-day"; }, 1400);
      } else if (confirmation.status === "pending") {
        setSuccessMsg("Attendance is saved securely and awaiting server confirmation.");
      } else {
        setErrorMsg("Attendance is saved, but needs review before it can be confirmed. Keep this device data and contact an administrator.");
      }
    } catch (err) {
      setErrorMsg("Clock-in failed. You may have already clocked in today.");
    } finally {
      setIsLoading(false);
    }
  };

  const formattedDate = formatISTDateKey(todayStr);

  if (isAdmin) {
    return (
      <div className="app-page">
        <PageHeader eyebrow="Attendance" icon={<ShieldAlert size={18} />} title="Administrator attendance" description="Administrator accounts do not create personal clock-in records." />
        <section className="access-state mt-4" aria-labelledby="admin-attendance-title">
          <span className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-[var(--radius-lg)] bg-[var(--brand-50)] text-[var(--brand-700)]"><ShieldAlert size={22} /></span>
          <h2 id="admin-attendance-title" className="text-lg font-semibold">Use the team attendance workspace</h2>
          <p className="mx-auto mt-2 max-w-sm text-[13px] leading-5 text-[var(--text-muted)]">Review field and office attendance, exports, and presence trends from the administrative attendance route.</p>
          <Link href="/admin/attendance" className="mt-5 inline-flex"><Button icon={<ArrowRight size={15} />}>Open team attendance</Button></Link>
        </section>
      </div>
    );
  }

  if (todayRecord) {
    const confirmed = confirmationState === "confirmed";
    return (
      <div className="app-page">
        <PageHeader eyebrow="Attendance" icon={confirmed ? <CheckCircle size={18} /> : <Clock size={18} />} title={confirmed ? "Attendance confirmed" : confirmationState === "review_required" ? "Attendance needs review" : "Attendance awaiting confirmation"} description={formattedDate} />
        <section className="mx-auto w-full max-w-xl overflow-hidden rounded-[var(--radius-xl)] border border-[var(--status-success)]/20 bg-[var(--surface-primary)] shadow-[var(--shadow-raised)]">
          <div className="bg-[var(--status-success-soft)] px-6 py-8 text-center">
            <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[var(--surface-primary)] text-[var(--status-success)] shadow-[var(--shadow-raised)]"><CheckCircle size={28} /></span>
            <h2 className="mt-4 text-xl font-semibold">{confirmed ? "You are clocked in" : "Your attendance is retained"}</h2>
            <p className="mt-1 text-[13px] text-[var(--text-secondary)]">Recorded at {new Date(todayRecord.clock_in).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>
          </div>
          <div className="space-y-5 p-6">
            <div className="flex items-center gap-4 rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--surface-secondary)] p-4">
              {capturedImage ? (
                <img src={capturedImage} alt="Attendance verification selfie" className="h-16 w-16 rounded-[var(--radius-lg)] object-cover" />
              ) : (
                <span className="grid h-16 w-16 place-items-center rounded-[var(--radius-lg)] bg-[var(--brand-100)] text-sm font-bold text-[var(--brand-800)]">{currentUser?.name?.slice(0, 2).toUpperCase() || "ZD"}</span>
              )}
              <div className="min-w-0">
                <p className="truncate text-[14px] font-semibold text-[var(--text-primary)]">{currentUser?.name}</p>
                <p className="mt-1 text-[12px] text-[var(--text-muted)]">{confirmed ? (requiresFieldEvidence ? "Field attendance verified with selfie" : "Office attendance recorded") : confirmationState === "review_required" ? "Server review is required; automatic retry has stopped" : "The durable queue will retry with bounded backoff"}</p>
              </div>
            </div>
            <Link href="/my-day" className="block"><Button className="w-full" icon={<ArrowRight size={15} />}>Continue to My Day</Button></Link>
          </div>
        </section>
      </div>
    );
  }

  if (usesOfficeAttendance) {
    return (
      <div className="app-page">
        <PageHeader eyebrow="Attendance" icon={<Clock size={18} />} title="Start your workday" description={formattedDate} />
        <div className="mx-auto grid w-full max-w-4xl gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
          <section className="surface-panel overflow-hidden" aria-labelledby="office-clock-title">
            <div className="border-b border-[var(--border-subtle)] bg-[var(--surface-secondary)] p-5 sm:p-6">
              <p className="section-kicker">Office clock-in</p>
              <h2 id="office-clock-title" className="mt-1 section-title">Confirm today’s attendance</h2>
            </div>
            <div className="space-y-5 p-5 sm:p-6">
              <div className="flex items-center gap-4 rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--surface-secondary)] p-4">
                <span className="grid h-11 w-11 place-items-center rounded-[var(--radius-md)] bg-[var(--brand-100)] text-[12px] font-bold text-[var(--brand-800)]">{currentUser?.name?.slice(0, 2).toUpperCase() || "ZD"}</span>
                <div><p className="text-[14px] font-semibold">{currentUser?.name}</p><p className="mt-1 text-[11px] text-[var(--text-muted)]">Office team member</p></div>
              </div>
              {errorMsg && <div className="alert-panel alert-panel--danger" role="alert"><AlertCircle size={16} className="mt-0.5 shrink-0" /><span>{errorMsg}</span></div>}
              <Button onClick={handleClockIn} isLoading={isLoading} className="w-full" icon={<LogIn size={16} />}>Clock in now</Button>
            </div>
          </section>
          <aside className="surface-panel p-5">
            <p className="section-kicker">What is recorded</p>
            <div className="mt-4 space-y-4">
              {["Your account identity", "Exact clock-in timestamp", "Current workday date"].map((item, index) => (
                <div key={item} className="flex gap-3"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-[var(--radius-sm)] bg-[var(--brand-50)] text-[10px] font-bold text-[var(--brand-700)]">0{index + 1}</span><p className="pt-1 text-[12px] leading-5 text-[var(--text-secondary)]">{item}</p></div>
              ))}
            </div>
          </aside>
        </div>
      </div>
    );
  }

  return (
    <div className="app-page">
      <PageHeader eyebrow="Attendance" icon={<Camera size={18} />} title="Selfie clock-in" description={`${formattedDate} · Centre your face in the guide and capture a clear verification image.`} />
      <section className="mx-auto w-full max-w-2xl overflow-hidden rounded-[var(--radius-xl)] border border-[var(--border-subtle)] bg-[var(--surface-primary)] shadow-[var(--shadow-raised)]">
        <div className="border-b border-[var(--border-subtle)] bg-[var(--surface-secondary)] p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3"><div><p className="section-kicker">Field verification</p><h2 className="mt-1 section-title">Camera preview</h2></div><span className={`inline-flex items-center gap-2 text-[11px] font-semibold ${streamActive ? "text-[var(--status-success)]" : "text-[var(--status-warning)]"}`}><span className={`h-2 w-2 rounded-full ${streamActive ? "bg-[var(--status-success)]" : "bg-[var(--status-warning)]"}`} />{streamActive ? "Camera ready" : "Connecting camera"}</span></div>
        </div>
        <div className="space-y-5 p-5 sm:p-6">
          <div className="relative mx-auto aspect-square w-full max-w-[460px] overflow-hidden rounded-[var(--radius-xl)] bg-[var(--surface-sidebar)] shadow-[inset_0_0_0_1px_var(--surface-inverse-outline)]">
            <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-cover" />
            {!streamActive && <div className="absolute inset-0 grid place-items-center text-[12px] font-semibold text-white/60">Requesting camera access…</div>}
            <div className="pointer-events-none absolute inset-0 grid place-items-center"><div className="h-[62%] w-[62%] rounded-[45%] border border-dashed border-white/55 shadow-[0_0_0_999px_var(--surface-inverse-mask)]" /></div>
            <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/35 px-3 py-1.5 text-[10px] font-medium text-white/85 backdrop-blur">Keep your face inside the frame</div>
          </div>
          <canvas ref={canvasRef} className="hidden" />
          {errorMsg && <div className="alert-panel alert-panel--danger" role="alert"><AlertCircle size={16} className="mt-0.5 shrink-0" /><span>{errorMsg}</span></div>}
          {successMsg && <div className="alert-panel alert-panel--success" role="status"><CheckCircle size={16} className="mt-0.5 shrink-0" /><span>{successMsg}</span></div>}
          <Button onClick={handleClockIn} isLoading={isLoading || !streamActive} className="w-full" icon={<Camera size={16} />}>Capture selfie and clock in</Button>
          <p className="text-center text-[11px] leading-5 text-[var(--text-muted)]">The image is stored with the attendance record and follows the existing offline sync process.</p>
        </div>
      </section>
    </div>
  );
}
