# Resource Health Runbook

Run `scripts/resource-health/read-only.sql` manually in the Supabase SQL editor when reviewing capacity. It is read-only and stores nothing. Check cached and uncached billing egress in the Supabase organization dashboard; do not add a Management API secret or polling job to the CRM.

- 50%: review growth, largest tables/buckets, and hot request paths.
- 70%: block feature release until the resource increase is optimized or explicitly approved.
- 80%: freeze non-essential growth and decide whether to upgrade the plan.

Use Vercel runtime-log grouping by request path for hot routes. Never sample sensitive row payloads.
