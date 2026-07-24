"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Navigation } from "lucide-react";
import SelfieCapture from "@/components/visits/SelfieCapture";
import { Button } from "@/components/ui/Button";

interface VisitEvidenceProps {
  onEvidenceChange: (evidence: { lat: number | null; lng: number | null; photoBlob: Blob | null }) => void;
}

export default function VisitEvidence({ onEvidenceChange }: VisitEvidenceProps) {
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [photoBlob, setPhotoBlob] = useState<Blob | null>(null);

  const requestLocation = useCallback(() => {
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
        console.warn("Location error:", err);
        setLocationError("Could not fetch location. Please ensure location services are enabled.");
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }, []);

  useEffect(() => {
    requestLocation();
  }, [requestLocation]);

  useEffect(() => {
    onEvidenceChange({ lat, lng, photoBlob });
  }, [lat, lng, photoBlob, onEvidenceChange]);

  return (
    <div className="space-y-6">
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
        <label className="field-label">Storefront Selfie <span className="text-[var(--status-danger)]">*</span></label>
        <SelfieCapture onCapture={setPhotoBlob} />
      </div>
    </div>
  );
}
