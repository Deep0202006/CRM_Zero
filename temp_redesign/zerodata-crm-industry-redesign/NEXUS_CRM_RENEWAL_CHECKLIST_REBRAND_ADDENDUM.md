# Nexus CRM — Renewal Cycle, Checklist Rework, My Day Stats & Full Rebrand
## Implementation Addendum

Builds on top of the base doc + all prior addenda (Task/KPI Guidebook, Sales Pipeline Optimization). Three change sets, each independent — apply in order.

---
---

# PART 1 — Sales Pipeline: Renewal Cycle, Checklist Rework, Universal Reminders, Support Resolution Notes

## 1.1 Renewal cycle — a converted client isn't finished, it's on a clock

Right now `Payment` is the last stop — a converted distributor just sits there forever with no prompt to renew. Add a full year-long lifecycle loop: `renewal_date` is set automatically the moment payment is recorded, a heads-up task fires 30 days out, and on the actual renewal date the lead flips into a new `Renewal Due` stage that the agent has to act on.

```sql
-- Track the renewal clock on the lead itself
alter table public.leads add column if not exists renewal_date date;
alter table public.leads add column if not exists renewal_reminder_sent boolean not null default false;

-- The moment payment is recorded, set the renewal date exactly 1 year out
create or replace function public.set_renewal_date()
returns trigger as $$
begin
    update public.leads
    set renewal_date = (new.paid_at::date + interval '1 year')::date
    where lead_id = new.lead_id;
    return new;
end;
$$ language plpgsql;

create trigger trg_set_renewal_date
after insert on public.lead_payment_details
for each row execute function public.set_renewal_date();

-- Nightly job: 30-day-out heads-up, then the actual stage flip on the day itself
create or replace function public.process_renewals(target_date date)
returns void as $$
begin
    -- 30 days out: heads-up task, status stays "Payment" (still an active client)
    insert into public.tasks (assigned_to, title, description, priority, source, related_lead_id, due_date)
    select assigned_to, 'Renewal coming up: ' || business_name,
           'Renewal due on ' || renewal_date || '. Reach out to confirm continuation.',
           'Medium', 'manual', lead_id, target_date
    from public.leads
    where status = 'Payment'
      and renewal_date = target_date + interval '30 days'
      and renewal_reminder_sent = false;

    update public.leads set renewal_reminder_sent = true
    where status = 'Payment' and renewal_date = target_date + interval '30 days';

    -- On the exact renewal date: flip stage, force a High-priority task
    update public.leads
    set status = 'Renewal Due'
    where status = 'Payment' and renewal_date = target_date;

    insert into public.tasks (assigned_to, title, description, priority, source, related_lead_id, due_date)
    select assigned_to, 'Renewal due today: ' || business_name,
           'Contact the client today to renew.', 'High', 'manual', lead_id, target_date
    from public.leads
    where status = 'Renewal Due' and renewal_date = target_date;
end;
$$ language plpgsql;

-- Schedule alongside the existing nightly KPI job:
-- select cron.schedule('nightly-renewals', '45 23 * * *',
--   $$ select public.process_renewals(current_date); $$);
```

**Transition map update (frontend `validation.ts` and any DB-level transition table):**

```
Payment      -> Renewal Due     (SYSTEM ONLY — block this in the manual transition
                                  map so an agent can't trigger it by hand; only the
                                  nightly cron function above is allowed to set it)
Renewal Due  -> Payment          (agent confirms renewal — client renewed)
Renewal Due  -> Not Interested   (agent confirms churn — mandatory loss_reason,
                                  same rule as the original Not Interested branch)
```

**Kanban board:** add a "Renewal Due" lane after Payment, using a distinct color (e.g. amber/pink, not reused from any existing lane) so it's visually unmistakable from a normal in-progress lead — this is a different kind of card, an existing client at risk, not a fresh prospect.

## 1.2 Registration checklist — corrected document set

Replace the previous 4-item checklist with the actual documents your team needs:

```sql
alter table public.lead_registration_checklist drop column if exists bank_details_captured;
alter table public.lead_registration_checklist drop column if exists agreement_signed;
alter table public.lead_registration_checklist add column if not exists drug_licence_uploaded boolean not null default false;
alter table public.lead_registration_checklist add column if not exists bill_photo_uploaded boolean not null default false;
-- gst_certificate_uploaded and pan_uploaded stay exactly as they were
```

Update the registration auto-task trigger (from the Sales Pipeline Optimization addendum) to match the new 4 documents:

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
        (new.assigned_to, 'Collect Drug Licence: ' || new.business_name, 'Required for registration.', 'High', 'manual', new.lead_id, current_date + 1),
        (new.assigned_to, 'Collect Bill Photo: ' || new.business_name, 'Required for registration.', 'Medium', 'manual', new.lead_id, current_date + 1);
    end if;
    return new;
end;
$$ language plpgsql;
```

**Frontend:** the Registration drawer's 4 checkboxes become: `GST Certificate`, `PAN Card`, `Drug Licence`, `Bill Photo`. The "Move to Installation" button stays disabled until all 4 are checked — that rule is unchanged, only the checklist contents changed.

## 1.3 Universal rule: every scheduled follow-up becomes a My Day reminder

This makes the reminder behavior consistent everywhere instead of being built one-off per feature. The pattern: **any time a date gets scheduled for future action, a task gets created due on that date** — this is already true for re-engagement (`re_engage_after`) and now needs to be true for call callbacks too:

```sql
-- "Call Back Later" outcome sets call_logs.next_call_at — this trigger turns
-- that into an actual task so it surfaces on My Day automatically.
create or replace function public.create_task_from_call_followup()
returns trigger as $$
begin
    if new.next_call_at is not null then
        insert into public.tasks (assigned_to, title, description, priority, source, related_lead_id, due_date)
        select l.assigned_to, 'Call back: ' || l.business_name, 'Scheduled follow-up call.',
               'Medium', 'manual', l.lead_id, new.next_call_at::date
        from public.leads l where l.lead_id = new.lead_id;
    end if;
    return new;
end;
$$ language plpgsql;

create trigger trg_call_followup_task
after insert on public.call_logs
for each row execute function public.create_task_from_call_followup();
```

Between this trigger, the re-engagement job, the renewal job, and the registration checklist trigger, **every** scheduled action in the pipeline now funnels through the same `tasks` table — which is also why the My Day fix in Part 2.1 below matters: it needs to catch not just tasks due exactly today, but anything still Pending from a past date too, or a missed follow-up silently disappears instead of nagging the agent until it's done.

## 1.4 Client support: require resolution notes on every closed ticket

Right now a ticket can be marked `Resolved` with zero record of what actually fixed it — useless for the next person who hits the same issue, and useless for spotting recurring problems.

```sql
alter table public.client_queries add column if not exists resolution_notes text;
alter table public.client_queries add column if not exists resolved_by uuid references public.users(user_id);
alter table public.client_queries add column if not exists resolved_at timestamp with time zone;

alter table public.internal_tickets add column if not exists resolution_notes text;
```

**Frontend rule (`/support` and tech_support ticket views):** clicking "Mark Resolved" opens a small required modal — one textarea, "How was this resolved?", minimum ~10 characters — before the status change is allowed to save. Block the API call client-side if empty, and also don't rely on client-side alone:

```sql
-- Server-side enforcement so this can't be bypassed by a direct API call
alter table public.client_queries add constraint resolution_notes_required
    check (problem_status != 'Resolved' or (resolution_notes is not null and length(trim(resolution_notes)) > 0));
```

---
---

# PART 2 — My Day: Add Pending & Scheduled-Later Counts

## 2.1 Fix task fetching to include overdue-but-incomplete tasks

Currently `getOrGenerateTodayTasks` only pulls tasks with `due_date === today`. With Part 1's new triggers generating tasks constantly, an agent who doesn't finish something needs it to keep showing up, not vanish the next day. Update `src/lib/taskEngine.ts`:

```typescript
// Replace the "due today only" query with "due today OR overdue and still open"
export async function getOrGenerateTodayTasks(
  userId: string,
  userCapabilities: string[]
): Promise<LocalTask[]> {
  const today = new Date().toISOString().slice(0, 10);

  const relevant = await db.tasks
    .where("assigned_to")
    .equals(userId)
    .and((t: LocalTask) => t.due_date <= today && t.status !== "Completed")
    .toArray();

  // ...generation logic for today's templates stays the same as before,
  // it just now merges into this broader "due today or overdue" set
  // instead of a strict due_date === today filter.
}
```

## 2.2 Add the two new stat counts to `/my-day`

```typescript
// src/lib/taskEngine.ts — new helper
export async function getMyDayStats(userId: string) {
  const today = new Date().toISOString().slice(0, 10);

  const pendingToday = await db.tasks
    .where("assigned_to").equals(userId)
    .and((t: LocalTask) => t.due_date <= today && t.status !== "Completed")
    .count();

  const scheduledLater = await db.tasks
    .where("assigned_to").equals(userId)
    .and((t: LocalTask) => t.due_date > today && t.status === "Pending")
    .count();

  return { pendingToday, scheduledLater };
}
```

```tsx
// src/app/my-day/page.tsx — add a stats row above the task list
const [stats, setStats] = useState({ pendingToday: 0, scheduledLater: 0 });

useEffect(() => {
  if (!user) return;
  getMyDayStats(user.user_id).then(setStats);
}, [user, tasks]); // re-run whenever tasks change so counts stay live

// In the JSX, above the task list:
<div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
  <div style={{ flex: 1, padding: 12, borderRadius: 10, background: "#fef2f2", textAlign: "center" }}>
    <div style={{ fontSize: 22, fontWeight: 700, color: "#991b1b" }}>{stats.pendingToday}</div>
    <div style={{ fontSize: 12, color: "#888" }}>Tasks pending</div>
  </div>
  <div style={{ flex: 1, padding: 12, borderRadius: 10, background: "#eff6ff", textAlign: "center" }}>
    <div style={{ fontSize: 22, fontWeight: 700, color: "#1e40af" }}>{stats.scheduledLater}</div>
    <div style={{ fontSize: 12, color: "#888" }}>Follow-ups scheduled later</div>
  </div>
</div>
```

`pendingToday` = everything due now or overdue, not yet done. `scheduledLater` = every future-dated task already queued (call-backs, renewal reminders, re-engagement dates) — this is what lets an agent glance at My Day and know "12 things scheduled ahead of me" without digging through the pipeline.

---
---

# PART 3 — Full Rebrand: Zero CRM → ZeroData

Three logo files are attached to this conversation already (from the earlier logo delivery) — reuse them exactly, do not re-crop or regenerate:

- `logo_icon_zd.png` — square ZD monogram, for sidebar and favicon
- `logo_wordmark.png` — "ZERODATA" wordmark, no tagline, for medium-width surfaces
- `logo_full_lockup.png` — full wordmark + "YOUR DATA IS YOURS" tagline, for the login screen

```
TASK: Remove "Zero CRM" everywhere in the app and replace with
"ZeroData" as the one product/brand name, with the logo properly
embedded — not just swapped text.

STEP 1 — Find every occurrence of the old name.
Search the entire codebase (case-insensitive) for:
  "Zero CRM"
  "ZeroCRM"
  "Enterprise OS"
This includes page titles, metadata, the sidebar header, the login
page, any README, and any hardcoded page <title> tags. Replace every
instance's visible text with "ZeroData" (the product IS ZeroData now,
not a CRM built by a separate company called ZeroData — simplify to
one name throughout).

STEP 2 — Sidebar header (src/components/DashboardLayout.tsx):
Replace the current icon+text block with:

  <div className="flex items-center gap-3 px-2 py-1">
    <img
      src="/logo-icon.png"
      alt="ZeroData"
      className="h-9 w-9 object-contain flex-shrink-0"
    />
    <div className="flex flex-col leading-tight">
      <span className="font-bold text-lg tracking-tight text-gray-900">
        ZeroData
      </span>
      <span className="text-[10px] uppercase tracking-wider text-gray-400">
        Your data is yours
      </span>
    </div>
  </div>

Keep the icon at exactly h-9 w-9 (36px), same rule as before — never
larger than the two text lines beside it.

STEP 3 — Login page (src/app/login/page.tsx), if present:
Use logo-full.png (the full lockup with tagline already baked in —
do not also render a separate "ZeroData" text heading underneath it,
the image already contains the full wordmark and tagline):

  <div className="flex justify-center mb-8">
    <img
      src="/logo-full.png"
      alt="ZeroData - Your data is yours"
      className="h-14 w-auto object-contain"
    />
  </div>

STEP 4 — Browser tab / metadata (root layout):
  export const metadata = {
    title: "ZeroData",
    icons: { icon: "/favicon-32x32.png" },
  };
Generate the favicon from logo-icon.png (square mark scales cleanly;
the wordmark does not).

STEP 5 — Any remaining surfaces:
Check for the app name in: PWA manifest.json (name and short_name
fields), any email/notification templates if they exist, any PDF/print
export headers (should use logo-wordmark.png per the earlier logo
addendum, still valid, just confirm the accompanying text next to it
now says "ZeroData" not "Zero CRM" if there is any text at all).

WHAT NOT TO DO:
- Do not leave "Zero CRM" as a secondary/subtitle anywhere — it's
  fully replaced, not demoted to a tagline.
- Do not resize the icon differently across sidebar/favicon/login —
  each surface has its specified size above, reuse those exact values.
- Do not add a background shape, border, or shadow behind any logo
  variant — all three files are already clean transparent PNGs.

VERIFICATION: After implementing, grep the codebase one more time for
"Zero CRM" (case-insensitive) and confirm zero remaining matches
outside of old comments/commit history. List every file changed.
```

---
---

# PART 4 — Implementation Checklist

1. Run all SQL in Part 1 (renewal columns/triggers, checklist column swap, call-followup trigger, resolution-notes columns/constraint) in order.
2. Add `'Renewal Due'` to the frontend status list and transition map, exactly per the rules in 1.1 — remember Payment → Renewal Due is system-only, block it from the manual UI.
3. Add the "Renewal Due" Kanban lane with distinct styling.
4. Schedule `process_renewals()` in the nightly cron alongside the existing KPI and re-engagement jobs.
5. Update the Registration drawer's 4 checkboxes to GST / PAN / Drug Licence / Bill Photo.
6. Add the resolution-notes required modal to the support ticket "Mark Resolved" action.
7. Update `taskEngine.ts` per Part 2.1 (overdue-inclusive fetching) and add `getMyDayStats()` per Part 2.2.
8. Add the two-stat row to `/my-day` above the task list.
9. Execute the full rebrand pass from Part 3 — search, replace, verify zero remaining "Zero CRM" matches.
10. **Regression test all three together:** push a test lead through to Payment, manually back-date `paid_at` by setting `renewal_date` to today and run `select public.process_renewals(current_date);` — confirm the lead flips to Renewal Due and a task appears. Log a call with a callback date of tomorrow, confirm a task appears on tomorrow's My Day. Resolve a support ticket without notes — confirm it's blocked; with notes — confirm it saves. Open My Day and confirm both new stat numbers are non-zero and accurate against the visible list. Confirm the sidebar, login page, and browser tab all show ZeroData branding with no leftover "Zero CRM" text anywhere.
