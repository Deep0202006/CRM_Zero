"use client";

import React, { useState, useEffect, useRef } from "react";
import { useAuth } from "@/context/AuthContext";
import { db, transactionalMutation, LocalLead } from "@/lib/db";
import { getCurrentISTDate } from "@/lib/dateTime";
import { SearchableSelect, SearchableOption } from "@/components/SearchableSelect";
import { MapPin, Navigation, Camera, CheckCircle2, AlertCircle, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/Button";
import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { CheckInGate } from "@/components/CheckInGate";
import excelUsers from "@/lib/excel_users.json";

export default function NewVisitPage() {
  const { currentUser } = useAuth();
  
  const [leadsMap, setLeadsMap] = useState<Map<string, LocalLead>>(new Map());
  const [selectedLeadId, setSelectedLeadId] = useState("");
  const [outcome, setOutcome] = useState("");
  const [notes, setNotes] = useState("");
  
  const [locationError, setLocationError] = useState<string | null>(null);
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [locating, setLocating] = useState(false);
  
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  // Photo
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [streamActive, setStreamActive] = useState(false);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [showCamera, setShowCamera] = useState(false);

  const outcomes = [
    "Successful Pitch",
    "Follow-up Required",
    "Not Interested",
    "Store Closed",
    "Other"
  ];

  const loadData = async () => {
    try {
      const allLeads = await db.leads.toArray();
      const lMap = new Map<string, LocalLead>();
      allLeads.forEach(l => lMap.set(l.lead_id, l));
      setLeadsMap(lMap);
    } catch (err) {
      console.error("Failed to load leads:", err);
    }
  };

  useEffect(() => {
    loadData();
    requestLocation();
  }, []);

  const requestLocation = () => {
    if (!navigator.geolocation) {
      setLocationError("Geolocation is not supported by your browser.");
      return;
    }
    setLocating(true);
    setLocationError(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLat(position.coords.latitude);
        setLng(position.coords.longitude);
        setLocating(false);
      },
      (err) => {
        setLocationError("Failed to get location. Please ensure location services are enabled.");
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  };

  const leadOptions: SearchableOption[] = React.useMemo(() => {
    const excelOptions: SearchableOption[] = (excelUsers as Array<{ username: string; name?: string }>).map((eu) => ({
      value: `EXCEL::${eu.username}::${eu.name || eu.username}`,
      label: `${eu.name || eu.username} (@${eu.username})`,
      searchText: eu.username + " " + (eu.name || "")
    }));
    return excelOptions.sort((a, b) => a.label.localeCompare(b.label));
  }, []);

  const initCamera = async () => {
    setShowCamera(true);
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setStreamActive(true);
      }
    } catch (err) {
      setError("Camera access denied. Please allow camera permissions.");
      setShowCamera(false);
    }
  };

  const capturePhoto = () => {
    if (!videoRef.current || !canvasRef.current) return;
    const ctx = canvasRef.current.getContext("2d");
    if (!ctx) return;
    canvasRef.current.width = videoRef.current.videoWidth || 640;
    canvasRef.current.height = videoRef.current.videoHeight || 480;
    ctx.drawImage(videoRef.current, 0, 0);
    setCapturedImage(canvasRef.current.toDataURL("image/jpeg", 0.7));
    
    // Stop stream
    if (videoRef.current.srcObject) {
      (videoRef.current.srcObject as MediaStream).getTracks().forEach(t => t.stop());
      setStreamActive(false);
    }
    setShowCamera(false);
  };

  const cancelCamera = () => {
    if (videoRef.current?.srcObject) {
      (videoRef.current.srcObject as MediaStream).getTracks().forEach(t => t.stop());
      setStreamActive(false);
    }
    setShowCamera(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;
    
    if (!selectedLeadId || !outcome) {
      setError("Please fill out required fields.");
      return;
    }
    
    if (!lat || !lng) {
      setError("Location is required for field visits.");
      return;
    }

    setSubmitting(true);
    setError("");
    setSuccess(false);

    try {
      const visitId = crypto.randomUUID();
      const now = new Date().toISOString();
      const visit_date = getCurrentISTDate();
      const check_in_time = now; // Store full ISO string for exact time

      const visitRecord = {
        visit_id: visitId,
        lead_id: selectedLeadId,
        user_id: currentUser.user_id,
        visit_date,
        check_in_time,
        check_in_lat: lat,
        check_in_lng: lng,
        check_in_photo_url: capturedImage,
        visit_outcome: outcome,
        visit_notes: notes.trim() || null,
        created_at: now,
        updated_at: now
      };

      await transactionalMutation("field_visits", "INSERT", visitRecord);
      
      setSuccess(true);
      setTimeout(() => {
        window.location.href = "/visits";
      }, 1500);
      
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to record visit.");
      setSubmitting(false);
    }
  };

  return (
    <CheckInGate>
      <div className="app-page max-w-2xl mx-auto">
        <PageHeader
          eyebrow="Field Operations"
          icon={<MapPin size={18} />}
          title="Log Field Visit"
          description="Record a visit to a store or distributor."
          actions={
            <Link href="/visits">
              <Button size="sm" variant="outline" icon={<ArrowLeft size={14} />}>
                Back to visits
              </Button>
            </Link>
          }
        />

        <section className="surface-panel overflow-hidden">
          <form onSubmit={handleSubmit} className="p-5 sm:p-6 space-y-6">
            
            {/* Location Section */}
            <div className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--surface-secondary)] p-4">
              <div className="flex items-start gap-3">
                <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${lat && lng ? 'bg-[var(--status-success-soft)] text-[var(--status-success)]' : 'bg-[var(--status-warning-soft)] text-[var(--status-warning)]'}`}>
                  <Navigation size={16} />
                </span>
                <div className="flex-1 min-w-0">
                  <h3 className="text-[13px] font-semibold text-[var(--text-primary)]">Location Capture</h3>
                  {locating ? (
                    <p className="mt-1 text-[12px] text-[var(--text-secondary)] animate-pulse">Acquiring GPS coordinates...</p>
                  ) : locationError ? (
                    <div className="mt-2 text-[12px] text-[var(--status-danger)]">
                      <p>{locationError}</p>
                      <Button type="button" size="sm" variant="outline" className="mt-2" onClick={requestLocation}>Retry</Button>
                    </div>
                  ) : lat && lng ? (
                    <div className="mt-1 text-[12px] text-[var(--text-secondary)]">
                      <p>Coordinates captured successfully.</p>
                      <p className="text-[10px] text-[var(--text-muted)] font-mono mt-0.5">{lat.toFixed(6)}, {lng.toFixed(6)}</p>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>

            <div>
              <label className="field-label">Target Lead or Client <span className="text-[var(--status-danger)]">*</span></label>
              <SearchableSelect options={leadOptions} value={selectedLeadId} onChange={setSelectedLeadId} placeholder="Search by name or username" required />
            </div>

            <div>
              <label htmlFor="visit-outcome" className="field-label">Visit Outcome <span className="text-[var(--status-danger)]">*</span></label>
              <select id="visit-outcome" value={outcome} onChange={(event) => setOutcome(event.target.value)} className="field-control" required>
                <option value="" disabled>Select an outcome</option>
                {outcomes.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
              </select>
            </div>

            <div>
              <label className="field-label">Storefront Photo <span className="text-[var(--text-muted)] font-normal">(Optional)</span></label>
              
              {showCamera ? (
                <div className="mt-2 rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--surface-primary)] overflow-hidden">
                  <div className="relative aspect-[4/3] bg-black">
                    <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
                  </div>
                  <canvas ref={canvasRef} className="hidden" />
                  <div className="flex justify-between p-3 bg-[var(--surface-secondary)] border-t border-[var(--border-subtle)]">
                    <Button type="button" variant="outline" onClick={cancelCamera}>Cancel</Button>
                    <Button type="button" onClick={capturePhoto} icon={<Camera size={15} />} disabled={!streamActive}>Capture</Button>
                  </div>
                </div>
              ) : capturedImage ? (
                <div className="mt-2 rounded-[var(--radius-lg)] border border-[var(--border-subtle)] overflow-hidden relative group">
                  <img src={capturedImage} alt="Storefront" className="w-full aspect-[4/3] object-cover" />
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <Button type="button" onClick={() => setCapturedImage(null)} variant="outline" className="bg-white/10 text-white border-white/20 hover:bg-white/20">Retake Photo</Button>
                  </div>
                </div>
              ) : (
                <div className="mt-2">
                  <Button type="button" variant="outline" onClick={initCamera} icon={<Camera size={15} />} className="w-full">
                    Open Camera
                  </Button>
                </div>
              )}
            </div>

            <div>
              <label htmlFor="visit-notes" className="field-label">Visit Notes <span className="font-normal text-[var(--text-muted)]">(optional)</span></label>
              <textarea id="visit-notes" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Observations, stock levels, or follow-up details" rows={4} className="field-control resize-y" />
            </div>

            {error && <div className="alert-panel alert-panel--danger" role="alert"><AlertCircle size={16} className="mt-0.5 shrink-0" /><span>{error}</span></div>}
            {success && <div className="alert-panel alert-panel--success" role="status"><CheckCircle2 size={16} className="mt-0.5 shrink-0" /><span>Visit recorded successfully.</span></div>}

            <div className="flex justify-end border-t border-[var(--border-subtle)] pt-5">
              <Button type="submit" isLoading={submitting} icon={<CheckCircle2 size={15} />} disabled={!selectedLeadId || !outcome || !lat || !lng}>Save Visit</Button>
            </div>
          </form>
        </section>
      </div>
    </CheckInGate>
  );
}
