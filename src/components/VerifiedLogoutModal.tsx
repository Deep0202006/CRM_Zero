"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, LogOut } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { db } from "@/lib/db";
import { getCurrentISTDate } from "@/lib/dateTime";
import { compressSelfie } from "@/lib/imageCompression";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";

type State = "idle" | "camera" | "capturing" | "logout" | "error";

export function VerifiedLogoutModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { currentUser, isFieldStaff, logout } = useAuth();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [state, setState] = useState<State>("idle");
  const [error, setError] = useState("");
  const [clockIn, setClockIn] = useState<string | null>(null);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const startCamera = useCallback(async () => {
    stopCamera();
    setError("");
    setState("camera");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
    } catch {
      stopCamera();
      setState("error");
      setError("Camera access is required. Check permission and retry.");
    }
  }, [stopCamera]);

  useEffect(() => {
    if (!open || !currentUser) return;
    db.attendance
      .where("[user_id+date]")
      .equals([currentUser.user_id, getCurrentISTDate()])
      .first()
      .then((record) => setClockIn(record?.clock_in ?? null));
    if (isFieldStaff) void startCamera();
    return stopCamera;
  }, [currentUser, isFieldStaff, open, startCamera, stopCamera]);

  const close = () => {
    if (state === "logout" || state === "capturing") return;
    stopCamera();
    setState("idle");
    setError("");
    onClose();
  };

  const finish = async (selfie?: File) => {
    setState("logout");
    setError("");
    const result = await logout(selfie);
    if (!result.ok) {
      stopCamera();
      setState("error");
      setError(result.error || "Logout could not be confirmed. Please retry.");
    }
  };

  const capture = async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) {
      setError("Camera is not ready. Please retry.");
      return;
    }
    setState("capturing");
    try {
      const scale = Math.min(1, 1280 / Math.max(video.videoWidth, video.videoHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
      if (!blob) throw new Error("Capture failed");
      const compressed = await compressSelfie(new File([blob], "clockout.jpg", { type: "image/jpeg" }));
      if (compressed.size > 350 * 1024) throw new Error("The selfie could not be compressed enough. Please retry.");
      stopCamera();
      await finish(compressed);
    } catch (captureError) {
      stopCamera();
      setState("error");
      setError(captureError instanceof Error ? captureError.message : "Capture failed. Please retry.");
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      size="sm"
      title={isFieldStaff ? "Verified field logout" : "Confirm logout"}
      description="Use Logout to record your clock-out. Closing the browser does not complete attendance."
      footer={
        <>
          <Button variant="outline" onClick={close} disabled={state === "logout" || state === "capturing"}>Cancel</Button>
          {isFieldStaff ? (
            <Button icon={<Camera size={16} />} onClick={state === "error" ? startCamera : capture} isLoading={state === "capturing" || state === "logout"}>
              {state === "error" ? "Retry camera" : "Capture selfie and logout"}
            </Button>
          ) : (
            <Button icon={<LogOut size={16} />} onClick={() => finish()} isLoading={state === "logout"}>Confirm clock-out and logout</Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        <div className="min-w-0 rounded-[var(--radius-md)] bg-[var(--surface-secondary)] p-3 text-[12px] leading-5">
          <p className="break-words font-semibold text-[var(--text-primary)]">{currentUser?.name}</p>
          <p className="text-[var(--text-muted)]">India date: {getCurrentISTDate()}</p>
          <p className="text-[var(--text-muted)]">Clock-in: {clockIn ? new Date(clockIn).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" }) : "Not available"}</p>
        </div>
        {isFieldStaff && (
          <div className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-black">
            <video ref={videoRef} muted playsInline className="aspect-[4/3] w-full object-cover [transform:scaleX(-1)]" aria-label="Live front camera preview" />
          </div>
        )}
        {state === "logout" && <p className="text-[13px] text-[var(--text-muted)]">Synchronizing work and confirming clock-out…</p>}
        {error && <p role="alert" className="rounded-[var(--radius-md)] bg-[var(--status-danger-soft)] p-3 text-[13px] text-[var(--status-danger)]">{error}</p>}
      </div>
    </Modal>
  );
}
