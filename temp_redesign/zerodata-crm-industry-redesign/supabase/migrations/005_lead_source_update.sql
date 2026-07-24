-- Replace the old check constraint with the corrected option list
alter table public.leads drop constraint if exists leads_lead_source_check;
alter table public.leads add constraint leads_lead_source_check
    check (lead_source in ('Referral','Cold Call','Inbound Inquiry','Social Media','Field Visit','Other'));

-- New column to capture free text when "Other" is selected
alter table public.leads add column if not exists lead_source_other text;

-- Migrate existing "Exhibition/Event" leads to "Other"
update public.leads set lead_source = 'Other', lead_source_other = 'Exhibition/Event'
where lead_source = 'Exhibition/Event';
