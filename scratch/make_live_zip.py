import os
import zipfile
import hashlib

zip_name = "TEAM_KPI_LIVE_DATA_CURRENT_SOURCE.zip"

exclude_dirs = [
    "node_modules", ".next", "dist", "build", "coverage", ".git", "scratch"
]

exclude_files = [
    ".env", ".env.local", ".env.production", ".env.development", ".env.test"
]

def should_exclude(path):
    parts = path.split(os.sep)
    for ed in exclude_dirs:
        if ed in parts:
            return True
    filename = os.path.basename(path)
    if filename in exclude_files:
        return True
    if filename.endswith(".zip"):
        return True
    if "make_live_zip.py" in filename:
        return True
    if "make_docs_live.py" in filename:
        return True
    return False

def zip_project(zip_filename):
    count = 0
    with zipfile.ZipFile(zip_filename, 'w', zipfile.ZIP_DEFLATED) as zipf:
        for root, dirs, files in os.walk("."):
            # modify dirs in place to skip excluded directories completely
            dirs[:] = [d for d in dirs if d not in exclude_dirs]
            for file in files:
                file_path = os.path.join(root, file)
                if not should_exclude(file_path):
                    arcname = os.path.relpath(file_path, ".")
                    zipf.write(file_path, arcname)
                    count += 1
    return count

file_count = zip_project(zip_name)
size_bytes = os.path.getsize(zip_name)
sha256_hash = hashlib.sha256()
with open(zip_name, "rb") as f:
    for byte_block in iter(lambda: f.read(4096), b""):
        sha256_hash.update(byte_block)
hash_hex = sha256_hash.hexdigest()

print(f"ZIP path: {zip_name}")
print(f"ZIP size: {size_bytes} bytes")
print(f"File count: {file_count}")
print(f"SHA-256: {hash_hex}")
