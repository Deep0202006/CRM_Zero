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
  ArrowRight,
} from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import Link from "next/link";

export default function AttendancePage() {
  const { currentUser, isFieldStaff, isOfficeStaff, isAdmin } = useAuth();

  const [todayRecord, setTodayRecord] = useState<LocalAttendance | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [streamActive, setStreamActive] = useState(false);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);

  const todayStr = new Date().toISOString().slice(0, 10);

  const loadTodayRecord = async () => {
    if (!currentUser) return;
    try {
      const records = await db.attendance.where("user_id").equals(currentUser.user_id).toArray();
      const today = records.find((r) => r.date === todayStr);
      if (today) {
        setTodayRecord(today);
        setCapturedImage(today.selfie_url ?? null);
      }
    } catch (err) {
      console.error("Failed to query attendance record", err);
    }
  };

  useEffect(() => {
    loadTodayRecord();
  }, [currentUser]);

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
        (videoRef.current.srcObject as MediaStream).getTracks().forEach((t) => t.stop());
      }
    };
  }, [isFieldStaff, todayRecord, currentUser]);

  const captureSelfie = (): string | null => {
    if (!videoRef.current || !canvasRef.current) return null;
    const ctx = canvasRef.current.getContext("2d");
    if (!ctx) return null;
    canvasRef.current.width = videoRef.current.videoWidth || 480;
    canvasRef.current.height = videoRef.current.videoHeight || 480;
    ctx.drawImage(videoRef.current, 0, 0);
    return canvasRef.current.toDataURL("image/jpeg", 0.7);
  };

  const handleClockIn = async () => {
    if (!currentUser) return;
    setIsLoading(true);
    setErrorMsg(null);

    let selfieUrl: string | null = null;

    if (isFieldStaff) {
      selfieUrl = captureSelfie();
      if (!selfieUrl) {
        setErrorMsg("Could not capture selfie. Please allow camera access and try again.");
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
        selfie_url: selfieUrl,
        latitude: null,
        longitude: null,
      };

      await transactionalMutation("attendance", "INSERT", newAttendance);

      setTodayRecord(newAttendance);
      setCapturedImage(selfieUrl);
      setSuccessMsg(isFieldStaff ? "Clock-in verified! Redirecting..." : "Clocked in! Redirecting...");
      setTimeout(() => {
        window.location.href = "/my-day";
      }, 1400);
    } catch (err) {
      setErrorMsg("Clock-in failed. You may have already clocked in today.");
    } finally {
      setIsLoading(false);
    }
  };

  if (isAdmin) {
    return (
      <Card className="max-w-md mx-auto mt-16 text-center space-y-4 p-8">
        <ShieldAlert size={40} className="mx-auto text-[var(--brand-500)]" />
        <h3 className="text-base font-black text-[var(--text-primary)]">Admin Accounts Don't Clock In</h3>
        <p className="text-xs text-[var(--text-muted)] font-semibold">
          Use <strong>Team Attendance</strong> in the sidebar to monitor your field team.
        </p>
      </Card>
    );
  }

  if (todayRecord) {
    return (
      <div className="max-w-sm mx-auto mt-10 space-y-6 text-center">
        <Card className="p-8 space-y-4 border-[var(--status-success)]/20">
          <CheckCircle size={48} className="mx-auto text-[var(--status-success)]" />
          <h2 className="text-xl font-black text-[var(--text-primary)]">You're Clocked In!</h2>
          <p className="text-xs text-[var(--text-muted)] font-semibold">
            {new Date(todayRecord.clock_in).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} — {todayStr}
          </p>
          {capturedImage && (
            <img
              src={capturedImage}
              alt="Attendance selfie"
              className="w-24 h-24 rounded-full object-cover border-4 border-[var(--status-success-soft)] mx-auto shadow-sm"
            />
          )}
          <Link href="/my-day" className="block w-full">
            <Button size="sm" className="w-full h-11" icon={<ArrowRight size={14} />}>
              Go to My Day
            </Button>
          </Link>
        </Card>
      </div>
    );
  }

  if (isOfficeStaff) {
    return (
      <div className="max-w-sm mx-auto mt-10 space-y-6">
        <div className="text-center">
          <Clock size={36} className="mx-auto text-[var(--brand-500)] mb-3" />
          <h2 className="text-2xl font-black text-[var(--text-primary)]">Mark Attendance</h2>
          <p className="text-xs text-[var(--text-muted)] font-semibold mt-1">
            {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
          </p>
        </div>

        <Card className="p-6 space-y-5">
          <div className="flex items-center gap-3 p-3 bg-[var(--surface-secondary)] rounded-[var(--radius-md)]">
            <div className="h-9 w-9 rounded-full bg-[var(--brand-500)] flex items-center justify-center text-white font-black text-xs">
              {currentUser?.name?.substring(0, 2).toUpperCase() || "US"}
            </div>
            <div>
              <p className="text-xs font-black text-[var(--text-primary)]">{currentUser?.name}</p>
              <p className="text-[10px] text-[var(--text-muted)] font-semibold">Office Staff</p>
            </div>
          </div>

          {errorMsg && (
            <div className="flex items-center gap-2 p-3 bg-[var(--status-danger-soft)] border border-[var(--status-danger)]/20 rounded-[var(--radius-md)] text-[var(--status-danger)] text-xs font-semibold">
              <AlertCircle size={14} /> {errorMsg}
            </div>
          )}

          <Button
            size="sm"
            onClick={handleClockIn}
            isLoading={isLoading}
            className="w-full h-11"
            icon={<LogIn size={16} />}
          >
            Clock In Now
          </Button>

          <p className="text-[10px] text-center text-[var(--text-muted)] font-semibold">
            Your clock-in time is recorded for daily operational KPIs.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-sm mx-auto mt-6 space-y-6">
      <div className="text-center">
        <Camera size={36} className="mx-auto text-[var(--brand-500)] mb-3" />
        <h2 className="text-2xl font-black text-[var(--text-primary)]">Selfie Clock-In</h2>
        <p className="text-xs text-[var(--text-muted)] font-semibold mt-1">
          {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
        </p>
      </div>

      <Card className="p-6 space-y-5">
        <div className="relative rounded-[var(--radius-lg)] overflow-hidden bg-slate-900 aspect-square">
          <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
          {!streamActive && (
            <div className="absolute inset-0 flex items-center justify-center text-white/60 text-xs font-semibold">
              Starting camera...
            </div>
          )}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-48 h-48 rounded-full border-2 border-white/40 border-dashed" />
          </div>
        </div>
        <canvas ref={canvasRef} className="hidden" />

        {errorMsg && (
          <div className="flex items-center gap-2 p-3 bg-[var(--status-danger-soft)] border border-[var(--status-danger)]/20 rounded-[var(--radius-md)] text-[var(--status-danger)] text-xs font-semibold">
            <AlertCircle size={14} /> {errorMsg}
          </div>
        )}
        {successMsg && (
          <div className="flex items-center gap-2 p-3 bg-[var(--status-success-soft)] border border-[var(--status-success)]/20 rounded-[var(--radius-md)] text-[var(--status-success)] text-xs font-semibold">
            <CheckCircle size={14} /> {successMsg}
          </div>
        )}

        <Button
          size="sm"
          onClick={handleClockIn}
          isLoading={isLoading || !streamActive}
          className="w-full h-11"
          icon={<Camera size={16} />}
        >
          Capture & Clock In
        </Button>

        <p className="text-[10px] text-center text-[var(--text-muted)] font-semibold">
          Selfie photo is stored locally and synced for verification.
        </p>
      </Card>
    </div>
  );
}
