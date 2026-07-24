# Current Visits Audit

## Issues Against Constraints
1. **Consolidated UI**: Retailer and Distributor visits currently share a single UI, making it harder to customize specific fields or workflows for each segment.
2. **Evidence Handling**: Location is grabbed on mount, but there's no strict state machine handling rejections, timeouts, or retries elegantly within a unified "evidence" block.
3. **Offline Sync**: The sync logic in `db.ts` handles the photo upload and insert sequentially. If the upload fails, it might silently fail or block the queue. We need robust dead-letter handling.

## Required Changes
- Split into `Retailer Visits` and `Distributor Visits` (e.g., tabs or separate pages).
- Create a unified `VisitEvidence` component that handles both Selfie and Location strictly.
- Improve offline resilience by ensuring `db.ts` isolates photo blob sync and data sync appropriately.
