# User Journey Audit

- **Open Visits**: Currently shows a list of recent visits, but doesn't distinguish sync state clearly.
- **Confirm Attendance**: Wrapped with `<CheckInGate>` but does not explicitly prevent local bypass if state is manipulated. It does not validate `India business date` properly (uses basic strings).
- **Capture Selfie**: Camera UX is poor; the permission request happens on load in some states, no file fallback is provided natively.
- **Select Business**: Uses an `excel_users.json` list instead of filtering CRM leads by segment. Search debouncing and stability is lacking.
- **Record Person Met**: Field is missing from current form.
- **Record Outcome**: Outcomes are currently incorrect.
- **Submit**: Submits to offline queue, but doesn't handle image compression, resulting in giant base64 strings in the queue and DB.
