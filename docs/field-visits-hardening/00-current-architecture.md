# Current Architecture

- **Routing & Pages**: `src/app/visits/page.tsx` displays the user's local visit history. `src/app/visits/new/page.tsx` acts as a routing hub for Retail and Distributor visit types.
- **Role Logic**: The app separates roles (`field_ret` vs `field_dist`) but relies heavily on client-side routing rather than strict backend validation of leads against capabilities at the time of visit insertion.
- **Outcomes**: Hardcoded arrays are used in the frontend forms instead of database-backed ENUMs.
- **Evidence Collection**: The `SelfieCapture.tsx` component relies on native `<input type="file" capture="user">` for stability, which is good, but does not perform client-side image compression.
- **Storage**: Uncompressed Base64 representations of images are currently passed around and stored in Dexie.
- **Offline Sync**: Uses the generic `transactionalMutation` which simply drops the massive Base64 payload into the `offline_queue`. There is no dedicated state machine for visits, causing potential queue bloat and failures.
