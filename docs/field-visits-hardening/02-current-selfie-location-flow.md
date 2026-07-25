# Current Selfie & Location Flow

- **Capture**: `SelfieCapture.tsx` utilizes `<input type="file" accept="image/*" capture="user" />`. This is robust and prevents the memory leaks associated with raw `getUserMedia`.
- **Location**: Fetched concurrently using `navigator.geolocation.getCurrentPosition`. 
- **Compression**: **Missing**. The application currently reads the file and converts the entire raw payload into a Base64 string.
- **Persistence**: The massive Base64 string is stored directly in IndexedDB (Dexie).
- **Upload**: The sync queue attempts to write the entire Base64 payload as part of the JSON row payload. The `check_in_photo_url` is supposed to point to Supabase Storage, but currently the upload process is not decoupled. The sync queue does not orchestrate "Upload to Storage -> Get URL -> Insert DB Row".
