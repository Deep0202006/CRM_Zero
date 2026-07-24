"use client";

import React, { useState, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { db, transactionalMutation, LocalCallLog, LocalUser, LocalLead } from "@/lib/db";
import { SearchableSelect, SearchableOption } from "@/components/SearchableSelect";
import { PhoneCall, CheckCircle2, AlertCircle, Download } from "lucide-react";
import excelUsers from "@/lib/excel_users.json";
import { exportCallLogs } from "@/lib/excelExport";
import { QueueList } from "@/components/QueueList";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

export default function CallLogsPage() {
  const { currentUser, isAdmin } = useAuth();
  
  const [loading, setLoading] = useState(true);
  const [logs, setLogs] = useState<LocalCallLog[]>([]);
  const [usersMap, setUsersMap] = useState<Map<string, LocalUser>>(new Map());
  const [leadsMap, setLeadsMap] = useState<Map<string, LocalLead>>(new Map());
  
  const [selectedLeadId, setSelectedLeadId] = useState("");
  const [outcome, setOutcome] = useState("");
  const [notes, setNotes] = useState("");
  const [nextFollowup, setNextFollowup] = useState("");
  
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  const commonOutcomes = [
    "No response (followup)",
    "Happy call",
    "Not interested",
    "Requested more info",
    "Wrong Number",
    "Other"
  ];

  const leadOptions: SearchableOption[] = React.useMemo(() => {
    const excelOptions: SearchableOption[] = excelUsers.map((eu: any) => ({
      value: `EXCEL::${eu.username}::${eu.name || eu.username}`,
      label: `${eu.name || eu.username} (@${eu.username})`,
      searchText: eu.username + " " + (eu.name || "")
    }));
    return excelOptions.sort((a, b) => a.label.localeCompare(b.label));
  }, []);

  const loadData = async () => {
    try {
      const fetchedLogs = await db.call_logs.toArray();
      fetchedLogs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      
      const allUsers = await db.users.toArray();
      const uMap = new Map<string, LocalUser>();
      allUsers.forEach(u => uMap.set(u.user_id, u));
      
      const allLeads = await db.leads.toArray();
      const lMap = new Map<string, LocalLead>();
      allLeads.forEach(l => lMap.set(l.lead_id, l));
      
      setUsersMap(uMap);
      setLeadsMap(lMap);
      setLogs(fetchedLogs);
    } catch (err) {
      console.error("Failed to load logs:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleLogCall = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;
    
    if (!selectedLeadId && !outcome) {
      setError("Please select a lead and provide an outcome.");
      return;
    }
    if (!selectedLeadId) {
      setError("Please select a lead.");
      return;
    }
    if (!outcome) {
      setError("Please select a call outcome/response.");
      return;
    }

    setSubmitting(true);
    setError("");
    setSuccess(false);

    try {
      const nextFollowupDate = (outcome === "No response (followup)" || outcome === "Requested more info") ? (nextFollowup || null) : null;

      const log: LocalCallLog = {
        log_id: crypto.randomUUID(),
        user_id: currentUser.user_id,
        lead_id: selectedLeadId,
        timestamp: new Date().toISOString(),
        outcome: outcome,
        notes: notes.trim() || null,
        next_followup_date: nextFollowupDate,
      };

      await transactionalMutation("call_logs", "INSERT", log);

      if (nextFollowupDate) {
        const leadNameMatch = selectedLeadId.split("::");
        const leadDisplay = leadNameMatch.length === 3 ? `${leadNameMatch[2]} (@${leadNameMatch[1]})` : selectedLeadId;
        
        const followupTask = {
          task_id: crypto.randomUUID(),
          assigned_to: currentUser.user_id,
          assigned_by: currentUser.user_id,
          title: "Follow-up Call",
          description: `Scheduled follow-up for: ${leadDisplay}\nNotes: ${notes.trim() || "No notes"}`,
          priority: "High" as const,
          status: "Pending" as const,
          source: "manual" as const,
          template_id: null,
          related_lead_id: selectedLeadId,
          due_date: nextFollowupDate,
          started_at: null,
          completed_at: null,
          proof_note: null,
          proof_photo_url: null,
          created_at: new Date().toISOString(),
        };
        await transactionalMutation("tasks", "INSERT", followupTask);
      }

      setSuccess(true);
      
      setSelectedLeadId("");
      setOutcome("");
      setNotes("");
      setNextFollowup("");
      
      await loadData();
      
      setTimeout(() => setSuccess(false), 3000);
    } catch (err: any) {
      setError(err.message || "Failed to log call.");
    } finally {
      setSubmitting(false);
    }
  };

  const showFollowup = outcome === "No response (followup)" || outcome === "Requested more info";

  // Format identity standard: "{Name} (@{Username}) - {Phone}"
  const getLeadDisplay = (lead_id: string) => {
    if (lead_id.startsWith("EXCEL::")) {
      const parts = lead_id.split("::");
      if (parts.length === 3) {
        return `${parts[2]} (@${parts[1]})`;
      }
    }
    const lead = leadsMap.get(lead_id);
    if (lead) {
      if (lead.business_name.includes("(@")) return lead.business_name;
      return `${lead.business_name} - ${lead.phone || "N/A"}`;
    }
    return lead_id;
  };

  const getAgentDisplay = (user_id?: string | null) => {
    if (!user_id) return "System/Unknown";
    const user = usersMap.get(user_id);
    if (!user) return "Unknown Agent";
    return `${user.name} (@${user.email})`;
  };

  return (
    <div className="space-y-6 w-full max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <PhoneCall size={24} className="text-[var(--brand-500)]" />
          <div>
            <h1 className="text-2xl font-black text-[var(--text-primary)]">Call Logs</h1>
            <p className="text-xs text-[var(--text-muted)] font-bold uppercase tracking-wider">
              Record manual calls made to distributors and retailers
            </p>
          </div>
        </div>
        
        {currentUser && (
          <Button
            size="sm"
            onClick={() => exportCallLogs(currentUser.user_id, isAdmin)}
            icon={<Download size={14} />}
          >
            Export Call Logs
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <Card className="lg:col-span-2 space-y-4">
          <h2 className="text-sm font-black text-[var(--text-primary)] flex items-center gap-2 border-b border-[var(--border-subtle)] pb-3">
            <PhoneCall size={16} className="text-[var(--brand-500)]" />
            Log Call Outcome
          </h2>

          <form onSubmit={handleLogCall} className="space-y-4">
            <div>
              <label className="block text-[10px] font-black text-[var(--text-muted)] uppercase tracking-widest mb-1.5">
                Select Lead
              </label>
              <SearchableSelect
                options={leadOptions}
                value={selectedLeadId}
                onChange={setSelectedLeadId}
                placeholder="Search by name or username..."
                required
              />
            </div>

            <div>
              <label className="block text-[10px] font-black text-[var(--text-muted)] uppercase tracking-widest mb-1.5">
                Call Response / Outcome
              </label>
              <select
                value={outcome}
                onChange={(e) => setOutcome(e.target.value)}
                className="w-full bg-[var(--surface-primary)] border border-[var(--border-default)] rounded-[var(--radius-md)] p-2.5 text-xs font-semibold text-[var(--text-primary)] focus:outline-none focus:border-[var(--brand-500)] focus:ring-2 focus:ring-[var(--brand-500)]/20 transition-all"
                required
              >
                <option value="" disabled>Select an outcome...</option>
                {commonOutcomes.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-black text-[var(--text-muted)] uppercase tracking-widest mb-1.5">
                Additional Notes <span className="text-[var(--text-muted)] font-normal">(Optional)</span>
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Any important details discussed..."
                rows={3}
                className="w-full bg-[var(--surface-primary)] border border-[var(--border-default)] rounded-[var(--radius-md)] p-3 text-xs font-medium text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--brand-500)] focus:ring-2 focus:ring-[var(--brand-500)]/20 transition-all resize-none"
              />
            </div>

            {showFollowup && (
              <Input
                label="Next Follow-up Date (Optional)"
                type="date"
                value={nextFollowup}
                onChange={(e) => setNextFollowup(e.target.value)}
              />
            )}

            {error && (
              <div className="p-3 bg-[var(--status-danger-soft)] text-[var(--status-danger)] rounded-[var(--radius-md)] flex items-start gap-2 border border-[var(--status-danger)]/20 text-xs font-semibold">
                <AlertCircle size={16} className="mt-0.5 shrink-0" />
                <p>{error}</p>
              </div>
            )}

            {success && (
              <div className="p-3 bg-[var(--status-success-soft)] text-[var(--status-success)] rounded-[var(--radius-md)] flex items-center gap-2 border border-[var(--status-success)]/20 text-xs font-semibold">
                <CheckCircle2 size={16} className="shrink-0" />
                <p>Call logged successfully!</p>
              </div>
            )}

            <Button
              type="submit"
              isLoading={submitting}
              className="w-full h-11"
            >
              Log Call
            </Button>
          </form>
        </Card>

        <QueueList
          title="Call History"
          items={logs.map(log => ({
            id: log.log_id,
            primaryNode: (
              <div>
                <p className="text-xs font-bold text-[var(--text-primary)] leading-snug">
                  {getLeadDisplay(log.lead_id)}
                </p>
                <p className="text-[10px] font-semibold text-[var(--text-muted)] mt-0.5 uppercase tracking-wider">
                  Agent: <span className="text-[var(--text-secondary)]">{getAgentDisplay(log.user_id)}</span>
                </p>
                {log.notes && (
                  <p className="text-xs text-[var(--text-secondary)] mt-1.5 bg-[var(--surface-secondary)] p-2 rounded-[var(--radius-sm)] italic">
                    {log.notes}
                  </p>
                )}
              </div>
            ),
            statusText: log.outcome,
            statusVariant: "brand",
            timestamp: new Date(log.timestamp).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }),
          }))}
          emptyMessage="No calls logged yet."
          onRefresh={loadData}
        />
      </div>
    </div>
  );
}
