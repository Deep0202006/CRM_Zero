# Test Matrix

## Login Tests
- Viewport at 320px: Ensure form is visible without scroll, no horizontal scrolling.
- Desktop Viewport: Ensure two-column layout looks correct.
- Auth flow: Successful login, incorrect credentials error state.

## Field Visits Tests
- Retailer vs Distributor sections.
- Location: Grant permissions (success), Deny permissions (error state).
- Selfie: Capture success, Retake.
- Submission: Offline state (saved to IndexedDB), Online sync (uploads photo, then inserts data).
