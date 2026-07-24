# Test Matrix

## Roles & Permissions
- Field Retail can create/view only retail visits.
- Field Distributor can create/view only distributor visits.
- Admin views all. Non-field users view none.

## Offline & Sync
- Visit saves locally with disconnected network.
- Displays as "Pending Sync".
- Syncs automatically when online.
- Failed sync preserves data and allows manual retry.
- Idempotency prevents duplicates on refresh/re-submit.

## Media
- Camera opens securely and captures image.
- Camera closes and stops tracks on exit/unmount.
- Fallback to `<input type="file" />` works.
- Image compresses to ~200KB before local save.
- Image uploads securely to private bucket path: `{user_id}/{visit_date}/{visit_id}.jpg`.
