"use client";

import React, { useState, useEffect, useRef } from "react";
import { useAuth } from "@/context/AuthContext";
import { db, transactionalMutation, LocalAttendance } from "@/lib/db";
import {
  Camera,
  CheckCircle,
  ShieldAlert,
  Clock,
  AlertCircle,
  LogIn,
} from "lucide-react";

export default function AttendancePage() {
  const { currentUser, isFieldStaff, isOfficeStaff, isAdmin } = useAuth();

  // Shared state
  const [todayRecord, setTodayRecord] = useState<LocalAttendance | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Field-staff (selfie) state
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [streamActive, setStreamActive] = useState(false);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);

  const todayStr = new Date().toISOString().slice(0, 10);

  // ── Load today's record ──────────────────────────────────────────────────
  const loadTodayRecord = async () => {
    if (!currentUser) return;
    try {
      const records = await db.attendance.where("user_id").equals(currentUser.user_id).toArray();
      const today = records.find(r => r.date === todayStr);
      if (today) {
        setTodayRecord(today);
        setCapturedImage(today.selfie_url ?? null);
      }
    } catch (err) {
      console.error("Failed to query attendance record", err);
    }
  };

  useEffect(() => { loadTodayRecord(); }, [currentUser]);

  // ── Field-staff: start camera ────────────────────────────────────────────
  const initCamera = async () => {
    if (!isFieldStaff || todayRecord) return;
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
    if (isFieldStaff && !todayRecord && currentUser) initCamera();
    return () => {
      if (videoRef.current?.srcObject) {
        (videoRef.current.srcObject as MediaStream).getTracks().forEach(t => t.stop());
      }
    };
  }, [isFieldStaff, todayRecord, currentUser]);

  // ── Field-staff: capture selfie ──────────────────────────────────────────
  const captureSelfie = (): string | null => {
    if (!videoRef.current || !canvasRef.current) return null;
    const ctx = canvasRef.current.getContext("2d");
    if (!ctx) return null;
    canvasRef.current.width  = videoRef.current.videoWidth  || 480;
    canvasRef.current.height = videoRef.current.videoHeight || 480;
    ctx.drawImage(videoRef.current, 0, 0);
    return canvasRef.current.toDataURL("image/jpeg", 0.7);
  };

  // ── Clock-in handler ─────────────────────────────────────────────────────
  const handleClockIn = async () => {
    if (!currentUser) return;
    setIsLoading(true);
    setErrorMsg(null);

    let selfieUrl: string | null = null;

    // Field staff: require selfie
    if (isFieldStaff) {
      selfieUrl = captureSelfie();
      if (!selfieUrl) {
        setErrorMsg("Could not capture selfie. Please allow camera access and try again.");
        setIsLoading(false);
        return;
      }
      // Stop camera stream
      if (videoRef.current?.srcObject) {
        (videoRef.current.srcObject as MediaStream).getTracks().forEach(t => t.stop());
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
        selfie_url: selfieUrl,
        latitude: null,
        longitude: null,
      };

      await transactionalMutation("attendance", "INSERT", newAttendance);

      setTodayRecord(newAttendance);
      setCapturedImage(selfieUrl);
      setSuccessMsg(isFieldStaff ? "Clock-in verified! Redirecting…" : "Clocked in! Redirecting to your tasks…");
      setTimeout(() => { window.location.href = "/my-day"; }, 1400);
    } catch (err) {
      setErrorMsg("Clock-in failed. You may have already clocked in today.");
    } finally {
      setIsLoading(false);
    }
  };

  // ── Admin has no attendance page ─────────────────────────────────────────
  if (isAdmin) {
    return (
      <div className="max-w-md mx-auto mt-16 p-8 bg-white rounded-3xl border border-slate-100 shadow-sm text-center space-y-4">
        <ShieldAlert size={40} className="mx-auto text-brand-primary" />
        <h3 className="text-lg font-black text-slate-900">Admin accounts don't clock in</h3>
        <p className="text-xs text-slate-500 font-semibold">
          Use <strong>Team Attendance</strong> in the sidebar to monitor your team.
        </p>
      </div>
    );
  }

  // ── Already clocked in ───────────────────────────────────────────────────
  if (todayRecord) {
    return (
      <div className="max-w-sm mx-auto mt-10 space-y-6 text-center">
        <div className="bg-white rounded-3xl border border-emerald-100 shadow-sm p-8 space-y-4">
          <CheckCircle size={48} className="mx-auto text-emerald-500" />
          <h2 className="text-xl font-black text-slate-900">You're clocked in!</h2>
          <p className="text-xs text-slate-400 font-semibold">
            {new Date(todayRecord.clock_in).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} — {todayStr}
          </p>
          {capturedImage && (
            <img
              src={capturedImage}
              alt="Attendance selfie"
              className="w-24 h-24 rounded-full object-cover border-4 border-emerald-100 mx-auto shadow"
            />
          )}
          <a
            href="/my-day"
            className="block w-full py-3 bg-brand-primary text-white text-xs font-black rounded-2xl hover:bg-brand-secondary transition-all shadow-md shadow-brand-primary/10"
          >
            Go to My Day →
          </a>
        </div>
      </div>
    );
  }

  // ── Office staff: instant clock-in ───────────────────────────────────────
  if (isOfficeStaff) {
    return (
      <div className="max-w-sm mx-auto mt-10 space-y-6">
        <div className="text-center">
          <Clock size={36} className="mx-auto text-brand-primary mb-3" />
          <h2 className="text-2xl font-black text-slate-900">Mark Attendance</h2>
          <p className="text-xs text-slate-400 font-semibold mt-1">
            {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
          </p>
        </div>

        <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-8 space-y-6">
          <div className="flex items-center gap-3 p-4 bg-brand-primary/5 rounded-2xl border border-brand-primary/10">
            <div className="h-10 w-10 rounded-full bg-brand-primary flex items-center justify-center text-white font-black text-sm">
              {currentUser?.name?.substring(0, 2).toUpperCase() || "US"}
            </div>
            <div>
              <p className="text-sm font-black text-slate-900">{currentUser?.name}</p>
              <p className="text-[10px] text-slate-400 font-semibold">Office Staff</p>
            </div>
          </div>

          {errorMsg && (
            <div className="flex items-center gap-2 p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-600 text-xs font-semibold">
              <AlertCircle size={14} />{errorMsg}
            </div>
          )}

          <button
            onClick={handleClockIn}
            disabled={isLoading}
            className="w-full flex items-center justify-center gap-2 py-4 bg-brand-primary hover:bg-brand-secondary text-white font-black rounded-2xl transition-all shadow-lg shadow-brand-primary/20 text-sm disabled:opacity-50 cursor-pointer"
          >
            <LogIn size={18} />
            {isLoading ? "Clocking in…" : "Clock In Now"}
          </button>

          <p className="text-[10px] text-center text-slate-400 font-semibold">
            Your clock-in time is recorded for KPI tracking.
          </p>
        </div>
      </div>
    );
  }

  // ── Field staff: selfie clock-in ─────────────────────────────────────────
  return (
    <div className="max-w-sm mx-auto mt-6 space-y-6">
      <div className="text-center">
        <Camera size={36} className="mx-auto text-brand-primary mb-3" />
        <h2 className="text-2xl font-black text-slate-900">Selfie Clock-In</h2>
        <p className="text-xs text-slate-400 font-semibold mt-1">
          {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
        </p>
      </div>

      <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-6 space-y-5">
        {/* Camera viewfinder */}
        <div className="relative rounded-2xl overflow-hidden bg-slate-900 aspect-square">
          <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
          {!streamActive && (
            <div className="absolute inset-0 flex items-center justify-center text-white/60 text-xs font-semibold">
              Starting camera…
            </div>
          )}
          {/* Face guide ring */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-48 h-48 rounded-full border-2 border-white/40 border-dashed" />
          </div>
        </div>
        <canvas ref={canvasRef} className="hidden" />

        {errorMsg && (
          <div className="flex items-center gap-2 p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-600 text-xs font-semibold">
            <AlertCircle size={14} />{errorMsg}
          </div>
        )}
        {successMsg && (
          <div className="flex items-center gap-2 p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-700 text-xs font-semibold">
            <CheckCircle size={14} />{successMsg}
          </div>
        )}

        <button
          onClick={handleClockIn}
          disabled={isLoading || !streamActive}
          className="w-full flex items-center justify-center gap-2 py-4 bg-brand-primary hover:bg-brand-secondary text-white font-black rounded-2xl transition-all shadow-lg shadow-brand-primary/20 text-sm disabled:opacity-50 cursor-pointer"
        >
          <Camera size={18} />
          {isLoading ? "Processing…" : "Capture & Clock In"}
        </button>

        <p className="text-[10px] text-center text-slate-400 font-semibold">
          Photo is stored locally and synced for verification.
        </p>
      </div>
    </div>
  );
}
