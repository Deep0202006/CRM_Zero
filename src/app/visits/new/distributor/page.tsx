"use client";

import React, { useState, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { db, LocalLead } from "@/lib/db";
import { FieldVisitsRepository } from "@/lib/fieldVisits/repository";
import { getCurrentISTDate } from "@/lib/dateTime";
import { SearchableSelect, SearchableOption } from "@/components/SearchableSelect";
import { MapPin, Navigation, CheckCircle2, AlertCircle, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/Button";
import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { CheckInGate } from "@/components/CheckInGate";
import SelfieCapture from "@/components/visits/SelfieCapture";

const blobToBase64 = (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

export default function NewDistributorVisitPage() {
  const { currentUser, capabilities } = useAuth();
  
  const [leadsMap, setLeadsMap] = useState<Map<string, LocalLead>>(new Map());
  const [selectedLeadId, setSelectedLeadId] = useState("");
  const [personMet, setPersonMet] = useState("");
  const [outcome, setOutcome] = useState("");
  const [notes, setNotes] = useState("");
  const [followUpDate, setFollowUpDate] = useState("");
  const [photoBlob, setPhotoBlob] = useState<Blob | null>(null);
  
  const [locationError, setLocationError] = useState<string | null>(null);
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [locCapturedAt, setLocCapturedAt] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  const outcomes = [
    { label: "New Installation", value: "installed" },
    { label: "Interested (Payment/Training/Discussion)", value: "interested" },
    { label: "Follow-up Required (Not Available/Issue)", value: "follow_up" },
    { label: "Not Interested / Price Issue", value: "not_interested" }
  ];

  const loadData = React.useCallback(async () => {
    try {
      const allLeads = await db.leads.toArray();
      const lMap = new Map<string, LocalLead>();
      
      const canAccessDistributor = capabilities.includes("field_dist") || capabilities.includes("admin");
      if (!canAccessDistributor) return;

      allLeads.forEach(l => {
        if (l.segment_type === "Distributor") {
          lMap.set(l.lead_id, l);
        }
      });
      
      setLeadsMap(lMap);
    } catch (err) {
      console.error("Failed to load leads:", err);
    }
  }, [capabilities]);

  const requestLocation = React.useCallback(() => {
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
        setAccuracy(position.coords.accuracy);
        setLocCapturedAt(new Date().toISOString());
        setLocating(false);
      },
      (err) => {
        console.warn("GPS error:", err);
        setLocationError("Failed to acquire GPS location. Ensure location services are enabled.");
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }, []);

  useEffect(() => {
    if (capabilities) {
      Promise.resolve().then(() => loadData());
    }
    Promise.resolve().then(() => requestLocation());
  }, [capabilities, loadData, requestLocation]);

  const leadOptions: SearchableOption[] = React.useMemo(() => {
    const options: SearchableOption[] = [];
    leadsMap.forEach((lead) => {
      options.push({
        value: lead.lead_id,
        label: `${lead.business_name}`,
        searchText: `${lead.business_name} ${lead.contact_person}`
      });
    });
    return options.sort((a, b) => a.label.localeCompare(b.label));
  }, [leadsMap]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;
    
    if (!selectedLeadId || !outcome || !personMet || !photoBlob) {
      setError("Please fill out required fields including selfie.");
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
      
      const today = getCurrentISTDate();
      const attendanceRec = await db.attendance.where({ user_id: currentUser.user_id, date: today }).first();
      
      if (!attendanceRec && !capabilities.includes("admin")) {
         throw new Error("You must check in for attendance today before logging visits.");
      }

      const mediaBase64 = await blobToBase64(photoBlob);
      const locationQuality = accuracy && accuracy <= 50 ? "high" : accuracy && accuracy <= 200 ? "medium" : "low";

      const visitRecord = {
        visit_id: visitId,
        lead_id: selectedLeadId,
        user_id: currentUser.user_id,
        visit_date,
        check_in_time: now,
        check_in_lat: lat,
        check_in_lng: lng,
        location_accuracy_m: accuracy,
        location_captured_at: locCapturedAt,
        location_acquisition_mode: 'gps',
        location_quality: locationQuality,
        check_in_photo_url: null,
        selfie_captured_at: now,
        selfie_capture_method: 'camera_or_upload',
        selfie_storage_path: null,
        visit_outcome: outcome,
        visit_notes: notes.trim() || null,
        person_met: personMet.trim() || null,
        segment_type: "Distributor",
        follow_up_date: followUpDate || null,
        attendance_id: attendanceRec?.attendance_id || null,
        sync_status: "pending_sync" as const,
        created_at: now,
        updated_at: now
      };

      await FieldVisitsRepository.saveVisitWithMedia(visitRecord, mediaBase64);
      
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
          eyebrow="Distributor Operations"
          icon={<MapPin size={18} />}
          title="Log Distributor Visit"
          description="Record a field visit to a distributor."
          actions={
            <Link href="/visits/new">
              <Button size="sm" variant="outline" icon={<ArrowLeft size={14} />}>
                Back
              </Button>
            </Link>
          }
        />

        <section className="surface-panel overflow-hidden">
          <form onSubmit={handleSubmit} className="p-5 sm:p-6 space-y-6">
            
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
                      <p className="text-[10px] text-[var(--text-muted)] font-mono mt-0.5">
                        {lat.toFixed(6)}, {lng.toFixed(6)} {accuracy ? `(±${Math.round(accuracy)}m)` : ''}
                      </p>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>

            <div>
              <label className="field-label">Distributor Name <span className="text-[var(--status-danger)]">*</span></label>
              <SearchableSelect options={leadOptions} value={selectedLeadId} onChange={setSelectedLeadId} placeholder="Search distributor business name" required />
            </div>

            <div>
              <label htmlFor="person-met" className="field-label">Person Met <span className="text-[var(--status-danger)]">*</span></label>
              <input type="text" id="person-met" value={personMet} onChange={(e) => setPersonMet(e.target.value)} className="field-control" placeholder="Name of owner/manager" required />
            </div>

            <div>
              <label htmlFor="visit-outcome" className="field-label">Visit Outcome <span className="text-[var(--status-danger)]">*</span></label>
              <select id="visit-outcome" value={outcome} onChange={(event) => setOutcome(event.target.value)} className="field-control" required>
                <option value="" disabled>Select an outcome</option>
                {outcomes.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
              </select>
            </div>

            {outcome === "follow_up" && (
               <div>
                 <label htmlFor="follow-up" className="field-label">Follow-up Date <span className="text-[var(--status-danger)]">*</span></label>
                 <input type="date" id="follow-up" value={followUpDate} onChange={(e) => setFollowUpDate(e.target.value)} min={getCurrentISTDate()} className="field-control" required />
               </div>
            )}

            <div>
              <label htmlFor="visit-notes" className="field-label">Visit Notes <span className="font-normal text-[var(--text-muted)]">(optional)</span></label>
              <textarea id="visit-notes" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Observations, stock levels, or follow-up details" rows={4} className="field-control resize-y" />
            </div>

            <div>
              <label className="field-label">Storefront Selfie <span className="text-[var(--status-danger)]">*</span></label>
              <SelfieCapture onCapture={setPhotoBlob} />
            </div>

            {error && <div className="alert-panel alert-panel--danger" role="alert"><AlertCircle size={16} className="mt-0.5 shrink-0" /><span>{error}</span></div>}
            {success && <div className="alert-panel alert-panel--success" role="status"><CheckCircle2 size={16} className="mt-0.5 shrink-0" /><span>Distributor visit saved locally. Syncing in background...</span></div>}

            <div className="flex justify-end border-t border-[var(--border-subtle)] pt-5">
              <Button type="submit" isLoading={submitting} icon={<CheckCircle2 size={15} />} disabled={!selectedLeadId || !outcome || !personMet || !photoBlob || !lat || !lng}>Save Visit</Button>
            </div>
          </form>
        </section>
      </div>
    </CheckInGate>
  );
}
