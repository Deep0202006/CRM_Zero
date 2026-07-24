# Location and Selfie State Machine

## Location Flow
- `IDLE`: Initial state.
- `LOCATING`: `getCurrentPosition` is running.
- `SUCCESS`: Latitude and longitude acquired.
- `ERROR_DENIED`: User denied permission.
- `ERROR_TIMEOUT`: Request took too long.

## Selfie Flow
- `IDLE`: Initial state, ready to open camera.
- `CAMERA_ACTIVE`: Media stream is active and showing preview.
- `CAPTURED`: Photo is captured as a Blob, previewing the still image.
- `ERROR`: Camera access failed (denied or no device).

## Evidence Validation
- `isEvidenceComplete = location === SUCCESS && selfie === CAPTURED`
