import os
import zipfile
import glob

def should_include(path):
    exclusions = ['.env', 'node_modules', '.next', '.git']
    for ex in exclusions:
        if ex in path:
            return False
    return True

zip_filename = 'FIELD_VISITS_PHASE1_REVIEW.zip'
if os.path.exists(zip_filename):
    os.remove(zip_filename)

files_to_zip = set()

# 1. Audit documents
audit_docs = [
    'docs/field-visits-hardening/00-current-architecture.md',
    'docs/field-visits-hardening/01-current-data-contract.md',
    'docs/field-visits-hardening/02-current-selfie-location-flow.md',
    'docs/field-visits-hardening/03-current-sync-flow.md',
    'docs/field-visits-hardening/04-admin-reporting-flow.md',
    'docs/field-visits-hardening/05-root-cause-register.md',
    'docs/field-visits-hardening/06-excel-export-contract.md',
    'docs/field-visits-hardening/07-test-matrix.md',
    'docs/field-visits-hardening/implementation-state.yaml',
]
for f in audit_docs: files_to_zip.add(f)

# 2. Manifests
manifests = [
    'AGENTS.md', 'CLAUDE.md', 'package.json', 'package-lock.json',
    'tsconfig.json', 'next.config.ts', 'supabase/config.toml'
]
for f in manifests: files_to_zip.add(f)

# 3, 4, 5. Frontend & Sync files
frontend_globs = [
    'src/app/visits/**/*',
    'src/app/admin/visits/**/*',
    'src/components/visits/**/*',
    'src/lib/*visit*',
    'src/lib/*Visit*',
    'src/lib/imageCompression.ts',
    'src/lib/dateTime.ts',
    'src/lib/db.ts',
    'src/lib/sync.ts',
    'src/lib/supabaseClient.ts',
    'src/lib/validation.ts',
    'src/context/AuthContext.tsx'
]
for g in frontend_globs:
    for f in glob.glob(g, recursive=True):
        if os.path.isfile(f):
            files_to_zip.add(f)

# 6. Database migrations
# I'll just include all migrations since they touch users, capabilities, attendance, visits, storage, audit logs, etc.
for f in glob.glob('supabase/migrations/*.sql'):
    files_to_zip.add(f)

# 7. Generated database types
for f in glob.glob('src/types/supabase.ts'):
    files_to_zip.add(f)

# 8. Tests
# Grab anything in __tests__ related to visits/sync/attendance
for g in ['__tests__/**/*visit*', '__tests__/**/*sync*', '__tests__/**/*attendance*']:
    for f in glob.glob(g, recursive=True):
        if os.path.isfile(f):
            files_to_zip.add(f)

# 9, 10, 11, 12. Reports
reports = [
    'docs/field-visits-hardening/PHASE1_GIT_STATE.txt',
    'docs/field-visits-hardening/PHASE1_MIGRATION_STATE.md',
    'docs/field-visits-hardening/PHASE1_DATABASE_SNAPSHOT.md',
    'docs/field-visits-hardening/PHASE2_PROPOSAL.md'
]
for f in reports: files_to_zip.add(f)

with zipfile.ZipFile(zip_filename, 'w', zipfile.ZIP_DEFLATED) as zipf:
    for file in sorted(files_to_zip):
        if os.path.exists(file) and should_include(file):
            zipf.write(file)

print(f"ZIP path: {os.path.abspath(zip_filename)}")
print(f"ZIP size: {os.path.getsize(zip_filename)} bytes")
count = len(zipfile.ZipFile(zip_filename).namelist())
print(f"File count: {count}")
