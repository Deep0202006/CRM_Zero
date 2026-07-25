"use client";

import React from "react";
import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { CheckInGate } from "@/components/CheckInGate";
import { MapPin, Store, Truck, ArrowLeft, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/Button";

export default function NewVisitSelectionPage() {
  return (
    <CheckInGate>
      <div className="app-page max-w-2xl mx-auto">
        <PageHeader
          eyebrow="Field Operations"
          icon={<MapPin size={18} />}
          title="Select Visit Type"
          description="Choose the type of location you are visiting."
          actions={
            <Link href="/visits">
              <Button size="sm" variant="outline" icon={<ArrowLeft size={14} />}>
                Back to visits
              </Button>
            </Link>
          }
        />

        <div className="grid gap-4 sm:grid-cols-2 mt-6">
          <Link href="/visits/new/retailer" className="group block">
            <div className="surface-panel h-full p-6 transition-all hover:-translate-y-1 hover:border-[var(--brand-300)] hover:shadow-[var(--shadow-card-hover)] relative overflow-hidden">
              <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
                <Store size={80} />
              </div>
              <div className="relative">
                <span className="grid h-12 w-12 place-items-center rounded-xl bg-[var(--brand-50)] text-[var(--brand-600)] mb-6">
                  <Store size={24} />
                </span>
                <h3 className="text-[18px] font-semibold text-[var(--text-primary)] mb-2">
                  Retailer Visit
                </h3>
                <p className="text-[14px] text-[var(--text-secondary)] leading-relaxed mb-6">
                  Log a visit to a pharmacy or chemist shop. Record new registrations, stock checks, and sales pitches.
                </p>
                <div className="flex items-center text-[13px] font-semibold text-[var(--brand-600)] group-hover:text-[var(--brand-700)]">
                  Continue to Retailer <ArrowRight size={16} className="ml-1" />
                </div>
              </div>
            </div>
          </Link>

          <Link href="/visits/new/distributor" className="group block">
            <div className="surface-panel h-full p-6 transition-all hover:-translate-y-1 hover:border-[var(--brand-300)] hover:shadow-[var(--shadow-card-hover)] relative overflow-hidden">
              <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
                <Truck size={80} />
              </div>
              <div className="relative">
                <span className="grid h-12 w-12 place-items-center rounded-xl bg-[var(--surface-secondary)] text-[var(--text-secondary)] border border-[var(--border-subtle)] mb-6">
                  <Truck size={24} />
                </span>
                <h3 className="text-[18px] font-semibold text-[var(--text-primary)] mb-2">
                  Distributor Visit
                </h3>
                <p className="text-[14px] text-[var(--text-secondary)] leading-relaxed mb-6">
                  Log a visit to a regional distributor. Record new installations, payment collections, and training sessions.
                </p>
                <div className="flex items-center text-[13px] font-semibold text-[var(--text-secondary)] group-hover:text-[var(--text-primary)]">
                  Continue to Distributor <ArrowRight size={16} className="ml-1" />
                </div>
              </div>
            </div>
          </Link>
        </div>
      </div>
    </CheckInGate>
  );
}
