"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/context/AuthContext";
import { db, transactionalMutation, LocalLead } from "@/lib/db";
import { getCurrentISTDate } from "@/lib/dateTime";
import { SearchableSelect, SearchableOption } from "@/components/SearchableSelect";
import { MapPin, CheckCircle2, AlertCircle, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/Button";
import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { CheckInGate } from "@/components/CheckInGate";
import VisitEvidence from "@/components/visits/VisitEvidence";

export default function NewRetailerVisitPage() {
  const { currentUser, capabilities } = useAuth();
  
  const [leadsMap, setLeadsMap] = useState<Map<string, LocalLead>>(new Map());
  const [selectedLeadId, setSelectedLeadId] = useState("");
  const [personMet, setPersonMet] = useState("");
  const [outcome, setOutcome] = useState("");
  const [notes, setNotes] = useState("");
  const [followUpDate, setFollowUpDate] = useState("");
  
  const [evidence, setEvidence] = useState<{ lat: number | null; lng: number | null; photoBlob: Blob | null }>({ lat: null, lng: null, photoBlob: null });
  
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  const outcomes = [
    "New Registration",
    "Inactive To Active",
    "Already Use",
    "Not interested",
    "Shop Close",
    "Owners Not Available",
    "Device issue",
    "Follow-up Required",
    "Other"
  ];

  const loadData = useCallback(async () => {
    try {
      const allLeads = await db.leads.toArray();
      const lMap = new Map<string, LocalLead>();
      
      const canAccessRetail = capabilities.includes("field_ret") || capabilities.includes("admin");
      if (!canAccessRetail) return;

      allLeads.forEach(l => {
        if (l.segment_type === "Retailer") {
          lMap.set(l.lead_id, l);
        }
      });
      
      setLeadsMap(lMap);
    } catch (err) {
      console.error("Failed to load leads:", err);
    }
  }, [capabilities]);

  useEffect(() => {
    if (capabilities) {
      loadData();
    }
  }, [capabilities, loadData]);

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
    
    if (!selectedLeadId || !outcome || !personMet || !evidence.photoBlob) {
      setError("Please fill out required fields including selfie.");
      return;
    }
    
    if (!evidence.lat || !evidence.lng) {
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

      const visitRecord = {
        visit_id: visitId,
        lead_id: selectedLeadId,
        user_id: currentUser.user_id,
        visit_date,
        check_in_time: now,
        check_in_lat: evidence.lat,
        check_in_lng: evidence.lng,
        check_in_photo_url: null,
        visit_outcome: outcome,
        visit_notes: notes.trim() || null,
        person_met: personMet.trim() || null,
        segment_type: "Retailer",
        follow_up_date: followUpDate || null,
        attendance_id: attendanceRec?.attendance_id || null,
        sync_status: "pending_sync" as const,
        local_photo_blob: evidence.photoBlob,
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

  const isFormValid = selectedLeadId && outcome && personMet && evidence.photoBlob && evidence.lat && evidence.lng;

  return (
    <CheckInGate>
      <div className="app-page max-w-2xl mx-auto">
        <PageHeader
          eyebrow="Retailer Operations"
          icon={<MapPin size={18} />}
          title="Log Retailer Visit"
          description="Record a field visit to a retail store."
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
            
            <VisitEvidence onEvidenceChange={setEvidence} />

            <div className="border-t border-[var(--border-subtle)] pt-6 mt-6">
              <label className="field-label">Retailer Name <span className="text-[var(--status-danger)]">*</span></label>
              <SearchableSelect options={leadOptions} value={selectedLeadId} onChange={setSelectedLeadId} placeholder="Search retailer business name" required />
            </div>

            <div>
              <label htmlFor="person-met" className="field-label">Person Met <span className="text-[var(--status-danger)]">*</span></label>
              <input type="text" id="person-met" value={personMet} onChange={(e) => setPersonMet(e.target.value)} className="field-control" placeholder="Name of owner/manager" required />
            </div>

            <div>
              <label htmlFor="visit-outcome" className="field-label">Visit Outcome <span className="text-[var(--status-danger)]">*</span></label>
              <select id="visit-outcome" value={outcome} onChange={(event) => setOutcome(event.target.value)} className="field-control" required>
                <option value="" disabled>Select an outcome</option>
                {outcomes.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
              </select>
            </div>

            {outcome === "Follow-up Required" && (
               <div>
                 <label htmlFor="follow-up" className="field-label">Follow-up Date <span className="text-[var(--status-danger)]">*</span></label>
                 <input type="date" id="follow-up" value={followUpDate} onChange={(e) => setFollowUpDate(e.target.value)} min={getCurrentISTDate()} className="field-control" required />
               </div>
            )}

            <div>
              <label htmlFor="visit-notes" className="field-label">Visit Notes <span className="font-normal text-[var(--text-muted)]">(optional)</span></label>
              <textarea id="visit-notes" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Observations, stock levels, or follow-up details" rows={4} className="field-control resize-y" />
            </div>

            {error && <div className="alert-panel alert-panel--danger" role="alert"><AlertCircle size={16} className="mt-0.5 shrink-0" /><span>{error}</span></div>}
            {success && <div className="alert-panel alert-panel--success" role="status"><CheckCircle2 size={16} className="mt-0.5 shrink-0" /><span>Retailer visit saved locally. Syncing in background...</span></div>}

            <div className="flex justify-end border-t border-[var(--border-subtle)] pt-5">
              <Button type="submit" isLoading={submitting} icon={<CheckCircle2 size={15} />} disabled={!isFormValid}>Save Visit</Button>
            </div>
          </form>
        </section>
      </div>
    </CheckInGate>
  );
}
