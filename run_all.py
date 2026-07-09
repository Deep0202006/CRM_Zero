import subprocess
import re
import sys

print("Starting LLM Council Pipeline...")

# Phase 1
print("Running Phase 1...")
p1 = subprocess.run(["python", "council_phase1.py"], capture_output=True, text=True)
print(p1.stdout)
if p1.stderr:
    print(p1.stderr)

if p1.returncode != 0:
    print("Phase 1 failed!")
    sys.exit(1)

# Extract session dir
match = re.search(r"SESSION_DIR=(.+)", p1.stdout)
if not match:
    print("Could not find SESSION_DIR in Phase 1 output")
    sys.exit(1)

session_dir = match.group(1).strip()
print(f"Detected SESSION_DIR: {session_dir}")

# Inject Gemini
print("Injecting Gemini response...")
p_inj = subprocess.run(["python", "add_gemini.py", session_dir], capture_output=True, text=True)
print(p_inj.stdout)
if p_inj.stderr:
    print(p_inj.stderr)

# Phase 2
print("Running Phase 2...")
p2 = subprocess.run(["python", "council_phase2.py", session_dir], capture_output=True, text=True)
print(p2.stdout)
if p2.stderr:
    print(p2.stderr)

if p2.returncode != 0:
    print("Phase 2 failed!")
    sys.exit(1)

# Phase 3
print("Running Phase 3...")
# Chairman model is glm-5.2
p3 = subprocess.run(["python", "council_phase3.py", session_dir, "glm-5.2"], capture_output=True, text=True)
print(p3.stdout)
if p3.stderr:
    print(p3.stderr)

if p3.returncode != 0:
    print("Phase 3 failed!")
    sys.exit(1)

print("\nPipeline Complete. You can view the final output.")
