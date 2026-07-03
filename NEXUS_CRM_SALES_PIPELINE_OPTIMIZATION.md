# Nexus CRM — Sales Pipeline Optimization
## Implementation Addendum: New → Contacted → Interested/Not Interested → Registration → Installation → Payment

This spec redesigns how the pipeline stages actually *work*, not just how they look. It's written from the perspective of the salesperson using it every day — a non-technical distributor-onboarding agent — and every feature below exists because it removes a specific point of friction or data loss in that daily workflow.

Builds on top of `NEXUS_CRM_DOCUMENTATION.md` (base) and `NEXUS_CRM_COMPLETE_GUIDEBOOK.md` Part 2 (pipeline stage tracking, `stage_entered_at`, stale-lead detection, auto follow-up tasks). Everything here is additive to that.

### The core design principle: progressive disclosure

The single biggest usability mistake in most CRMs is showing every field on every lead, all the time. A non-technical agent opening a lead card and seeing 20 empty fields either panics or ignores it. Instead: **each stage shows only the fields relevant to that stage.** A lead in "New" shows 3 fields. A lead in "Registration" shows a document checklist. Nothing more.

---

## 1. Schema additions

```sql
-- =====================================================================
-- A. Lead source — required at creation, feeds channel-performance KPIs
-- =====================================================================
alter table public.leads add column if not exists lead_source text
    check (lead_source in ('Referral','Cold Call','Inbound Inquiry','Exhibition/Event','Field Visit','Other'));

-- Re-engagement date for lost leads — a "Not Interested" lead is not dead,
-- it's dormant. This is what brings it back instead of losing it forever.
alter table public.leads add column if not exists re_engage_after date;

-- =====================================================================
-- B. Structured call outcomes — extends the existing call_logs table.
-- One tap instead of a typed note, and it's now queryable for KPIs.
-- =====================================================================
alter table public.call_logs add column if not exists outcome text
    check (outcome in ('No Answer','Call Back Later','Interested','Not Interested','Switched Off','Wrong Number'));
alter table public.call_logs add column if not exists next_call_at timestamp with time zone;

-- =====================================================================
-- C. Registration checklist — the single biggest cause of deals stalling.
-- =====================================================================
create table public.lead_registration_checklist (
    checklist_id uuid primary key default gen_random_uuid(),
    lead_id uuid references public.leads(lead_id) unique not null,
    gst_certificate_uploaded boolean not null default false,
    pan_uploaded boolean not null default false,
    bank_details_captured boolean not null default false,
    agreement_signed boolean not null default false,
    territory_assigned text,
    updated_at timestamp with time zone default timezone('utc'::text, now())
);

-- =====================================================================
-- D. Installation details — proof of work, not just a status flip.
-- =====================================================================
create table public.lead_installation_details (
    installation_id uuid primary key default gen_random_uuid(),
    lead_id uuid references public.leads(lead_id) unique not null,
    installed_by uuid references public.users(user_id),
    installation_date date,
    software_version text,
    staff_trained_count int default 0,
    issues_encountered text,
    proof_photo_url text,
    created_at timestamp with time zone default timezone('utc'::text, now())
);

-- =====================================================================
-- E. Payment details — clean structured record, not a note in a text box.
-- =====================================================================
create table public.lead_payment_details (
    payment_id uuid primary key default gen_random_uuid(),
    lead_id uuid references public.leads(lead_id) unique not null,
    amount numeric not null,
    payment_mode text check (payment_mode in ('Bank Transfer','UPI','Cheque','Cash')),
    receipt_url text,
    collected_by uuid references public.users(user_id),
    paid_at timestamp with time zone default timezone('utc'::text, now())
);

-- =====================================================================
-- F. RLS — same visibility pattern as leads: own records + admin.
-- =====================================================================
alter table public.lead_registration_checklist enable row level security;
alter table public.lead_installation_details enable row level security;
alter table public.lead_payment_details enable row level security;

create policy checklist_access on public.lead_registration_checklist for all using (
    exists (select 1 from public.leads l where l.lead_id = lead_registration_checklist.lead_id
        and (l.assigned_to = auth.uid() or public.check_user_capability(auth.uid(), 'admin')))
);
create policy installation_access on public.lead_installation_details for all using (
    exists (select 1 from public.leads l where l.lead_id = lead_installation_details.lead_id
        and (l.assigned_to = auth.uid() or public.check_user_capability(auth.uid(), 'admin')))
);
create policy payment_access on public.lead_payment_details for all using (
    exists (select 1 from public.leads l where l.lead_id = lead_payment_details.lead_id
        and (l.assigned_to = auth.uid() or public.check_user_capability(auth.uid(), 'admin')))
);
```

---

## 2. Stage-by-stage: what the salesperson actually sees

| Stage | Fields shown | Primary action | What it prevents |
|---|---|---|---|
| **New** | Business name, phone, area, lead source | Big "Call now" button (`tel:` link) | Slow lead entry that makes agents avoid the CRM |
| **Contacted** | One-tap outcome buttons | Outcome capture modal appears the instant "Call now" is tapped | Typed notes nobody writes consistently |
| **Interested** | Free-text "what interests them" | "Move to Registration" | — |
| **Not Interested** | Mandatory loss reason + optional re-engage date | "Save & close" | Leads vanishing permanently on a bad day |
| **Registration** | 4-item document checklist, progress bar | Disabled "Move to Installation" until checklist complete | Deals stalling silently on missing paperwork |
| **Installation** | Date, software version, staff trained count, photo, issues | "Move to Payment" | No proof of work performed |
| **Payment** | Amount, mode, receipt upload | "Mark as Paid" — converts lead to active client | Unclean/unclear revenue records |

## 3. One-tap call outcome capture

The web app can't detect when a phone call actually ends, so the pattern is: tapping "Call" opens the dialer **and** immediately shows the outcome buttons — the agent fills it in right after hanging up, while it's still fresh, not from memory later.

```tsx
// Inside the lead drawer, New/Contacted stage view
function CallAction({ lead, onOutcome }: { lead: Lead; onOutcome: (outcome: string) => void }) {
  const [showOutcome, setShowOutcome] = useState(false);

  return (
    <div>
      <a
        href={`tel:${lead.phone}`}
        onClick={() => setShowOutcome(true)}
        className="block text-center py-3 rounded-lg bg-indigo-600 text-white font-medium"
      >
        📞 Call {lead.contact_person}
      </a>

      {showOutcome && (
        <div className="grid grid-cols-2 gap-2 mt-3">
          {["No Answer", "Call Back Later", "Interested", "Not Interested"].map((outcome) => (
            <button
              key={outcome}
              onClick={() => { onOutcome(outcome); setShowOutcome(false); }}
              className="py-2 rounded-lg border text-sm font-medium"
            >
              {outcome}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

Logging an outcome writes a `call_logs` row and auto-advances the lead: `"Interested"` moves status to `Interested`; `"Not Interested"` opens the mandatory loss-reason field; `"Call Back Later"` prompts a date picker that writes to `call_logs.next_call_at` and creates a task due that date — no manual task creation needed.

## 4. Registration checklist — auto-generated, not remembered

When a lead enters `Registration`, extend the existing stage-change trigger (from the base Guidebook Part 2) to spin up the checklist row and one task per document, so the agent sees exactly what's missing instead of a vague "follow up":

```sql
create or replace function public.init_registration_checklist()
returns trigger as $$
begin
    if new.status = 'Registration' and old.status is distinct from 'Registration' then
        insert into public.lead_registration_checklist (lead_id)
        values (new.lead_id)
        on conflict (lead_id) do nothing;

        insert into public.tasks (assigned_to, title, description, priority, source, related_lead_id, due_date)
        values
        (new.assigned_to, 'Collect GST certificate: ' || new.business_name, 'Required for registration.', 'High', 'manual', new.lead_id, current_date + 1),
        (new.assigned_to, 'Collect PAN card: ' || new.business_name, 'Required for registration.', 'High', 'manual', new.lead_id, current_date + 1),
        (new.assigned_to, 'Capture bank details: ' || new.business_name, 'Required for payment setup.', 'Medium', 'manual', new.lead_id, current_date + 1),
        (new.assigned_to, 'Get agreement signed: ' || new.business_name, 'Final step before installation.', 'High', 'manual', new.lead_id, current_date + 2);
    end if;
    return new;
end;
$$ language plpgsql;

create trigger trg_init_registration_checklist
after update on public.leads
for each row execute function public.init_registration_checklist();
```

**Frontend:** the Registration drawer renders the checklist as 4 checkboxes bound to `lead_registration_checklist`. The "Move to Installation" button is disabled (grayed out, with a tooltip: "Complete all documents first") until all 4 are checked — admins can override, agents cannot. This single rule is what stops half-registered distributors from silently sitting in limbo for weeks.

## 5. Re-engagement — a lost lead isn't a dead lead

If an agent sets `re_engage_after` when marking a lead Not Interested, a nightly job (add this call to the existing Part 1 nightly cron job) surfaces it back onto their My Day list automatically:

```sql
create or replace function public.surface_reengagement_leads()
returns void as $$
begin
    insert into public.tasks (assigned_to, title, description, priority, source, related_lead_id, due_date)
    select assigned_to, 'Re-engage: ' || business_name,
           'Marked not interested earlier — scheduled re-engagement window has arrived.',
           'Medium', 'manual', lead_id, current_date
    from public.leads
    where status = 'Not Interested' and re_engage_after = current_date and assigned_to is not null;
end;
$$ language plpgsql;

-- Add to the nightly schedule alongside compute_daily_kpi_snapshot():
-- select cron.schedule('nightly-reengage', '50 23 * * *', $$ select public.surface_reengagement_leads(); $$);
```

## 6. Funnel & source KPIs — this is what makes the pipeline improve the business

Three new views, separate from the per-user `kpi_daily_snapshot` from the base Guidebook — these are pipeline-wide, not per-agent:

```sql
-- Where are leads piling up right now?
create or replace view public.pipeline_funnel_summary as
select segment_type, status, count(*) as lead_count
from public.leads
group by segment_type, status;

-- Which lead source actually converts? Answers "where should we spend
-- more effort generating leads."
create or replace view public.lead_source_performance as
select
    lead_source, segment_type,
    count(*) as total_leads,
    count(*) filter (where status = 'Payment') as converted,
    round(100.0 * count(*) filter (where status = 'Payment') / nullif(count(*),0), 1) as conversion_rate_pct
from public.leads
where lead_source is not null
group by lead_source, segment_type;

-- Which stage is the actual bottleneck? Answers "where deals go to die."
create or replace view public.avg_time_in_stage as
select
    status, segment_type,
    round(avg(extract(epoch from (now() - stage_entered_at)) / 86400), 1) as avg_days_in_current_stage
from public.leads
where status not in ('Payment', 'Not Interested')
group by status, segment_type;
```

**Frontend:** add a "Funnel" tab next to the existing Team KPIs page (`/manager/kpi`). Render `pipeline_funnel_summary` as a horizontal funnel chart (widest at New, narrowing toward Payment), `lead_source_performance` as a simple ranked table, and `avg_time_in_stage` as a bar chart — the stage with the tallest bar is the one to investigate first. This turns "we're not converting enough distributors" from a vague complaint into "leads are sitting an average of 9 days in Registration, and it's the paperwork checklist" — an actual, fixable finding.

---

## 7. Implementation checklist

1. Run the SQL in Section 1 (schema + RLS).
2. Update the lead creation form: 4 fields only (business name, phone, area, lead source), defaulting `assigned_to` to self.
3. Build the stage-aware drawer that swaps its field set based on `lead.status` (Section 2 table is the spec for each variant).
4. Implement the call-outcome capture component from Section 3, wire outcomes to `call_logs` and auto-advance `leads.status`.
5. Run the checklist trigger from Section 4; build the 4-checkbox Registration UI with the disabled-until-complete button.
6. Run the re-engagement function from Section 5, add it to the nightly cron schedule.
7. Run the 3 views in Section 6; add the "Funnel" tab to `/manager/kpi` with the funnel chart, source table, and time-in-stage chart.
8. Test end-to-end: create a lead, call it, mark Interested, move through Registration (confirm the button stays disabled until all 4 boxes are checked), Installation, Payment — confirm a row lands in `lead_payment_details` and the lead disappears from the active funnel view. Separately, mark a different lead Not Interested with a re-engage date of tomorrow, then manually run `select public.surface_reengagement_leads();` with `current_date` mocked to tomorrow and confirm a task appears.
