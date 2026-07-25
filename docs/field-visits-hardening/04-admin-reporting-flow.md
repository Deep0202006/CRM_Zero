# Admin Reporting Flow

- **UI Location**: `src/app/admin/visits/page.tsx`
- **Data Loading**: Fetches all `field_visits`, `users`, and `leads` into memory to build relations client-side. This is prone to scaling issues.
- **Filters**: Basic client-side filtering for Outcome, Agent, and generic text search.
- **Evidence Viewing**: Uses `PhotoViewerLink` to dynamically generate signed URLs for objects in the `visits-evidence` bucket.
- **Exporting**: Contains a placeholder "Export to CSV" button that doesn't hook into any backend generator. The required 4-sheet Excel export is entirely missing.
