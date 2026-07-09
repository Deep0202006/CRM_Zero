import sys
import os
import json
import requests
import time

API_KEY = "freellmapi-b2397ee851321aaf9d9fae868c4d1eb0babb9a1f331aa016"
API_URL = "http://localhost:5173/v1/chat/completions"

if len(sys.argv) < 3:
    print("Usage: python council_phase3.py <SESSION_DIR> <CHAIRMAN_MODEL>")
    sys.exit(1)

SESSION_DIR = sys.argv[1]
CHAIRMAN_MODEL = sys.argv[2]

with open(f"{SESSION_DIR}/config.json", encoding="utf-8") as f:
    config = json.load(f)
with open(f"{SESSION_DIR}/phase1_responses.json", encoding='utf-8') as f:
    phase1 = json.load(f)
with open(f"{SESSION_DIR}/phase2_rankings.json", encoding='utf-8') as f:
    phase2 = json.load(f)

QUERY = config["query"]
model_to_label = phase2["model_to_label"]
label_to_model = phase2["label_mapping"]

responses_text = []
for model_id, result in phase1.items():
    label = model_to_label.get(model_id, "?")
    responses_text.append(f"=== {label}: {model_id} ===\n{result.get('content', '')}")

rankings_text = []
for model_id, result in phase2.get("rankings", {}).items():
    rankings_text.append(f"[{model_id}'s Rankings]\n{result.get('content', '')}")

synthesis_prompt = f"ORIGINAL QUERY:\n{QUERY}\n\nINDIVIDUAL RESPONSES:\n{chr(10).join(responses_text)}\n\nMODEL RANKINGS:\n{chr(10).join(rankings_text)}\n\nProduce a FINAL SYNTHESIS that incorporates the best elements and provides the ultimate answer."

print(f"\nPHASE 3: Chairman Synthesis ({CHAIRMAN_MODEL})")

try:
    start = time.time()
    response = requests.post(
        API_URL,
        headers={"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"},
        json={
            "model": CHAIRMAN_MODEL,
            "messages": [
                {"role": "system", "content": "You are the Chairman of an LLM Council. Synthesize multiple AI perspectives into a definitive, comprehensive response."},
                {"role": "user", "content": synthesis_prompt}
            ],
            "max_tokens": 4000,
            "temperature": 0.7
        },
        timeout=180
    )
    response.raise_for_status()
    synthesis = response.json()["choices"][0]["message"]["content"]

    with open(f"{SESSION_DIR}/phase3_synthesis.txt", "w", encoding='utf-8') as f:
        f.write(synthesis)
    print(f"Phase 3 complete. Synthesis saved.")
except Exception as e:
    print(f"ERROR: {e}")
    with open(f"{SESSION_DIR}/phase3_synthesis.txt", "w", encoding='utf-8') as f:
        f.write(f"[ERROR: {str(e)}]")

config["chairman"] = CHAIRMAN_MODEL
with open(f"{SESSION_DIR}/config.json", "w", encoding='utf-8') as f:
    json.dump(config, f, indent=2, ensure_ascii=False)


# Step 5: Display Full Results
output = []
output.append("=" * 70)
output.append("                  LLM COUNCIL DELIBERATION")
output.append("                  Powered by FreeLLMapi")
output.append("=" * 70)
output.append("")
output.append(f"QUERY: {config['query']}")
output.append(f"COUNCIL: {', '.join(config['models'])}")
output.append(f"CHAIRMAN: {config.get('chairman', 'N/A')}")
output.append("")

output.append("-" * 70)
output.append("                 PHASE 1: INDIVIDUAL RESPONSES")
output.append("-" * 70)
output.append("")

for model_id, result in phase1.items():
    label = model_to_label.get(model_id, "?")
    latency = result.get("latency_seconds", "N/A")
    output.append(f"[{label}] {model_id} (latency: {latency}s)")
    output.append("-" * 40)
    output.append(result.get("content", ""))
    output.append("")

output.append("-" * 70)
output.append("                 PHASE 2: CROSS-MODEL RANKINGS")
output.append("-" * 70)
output.append("")

for model_id, result in phase2.get("rankings", {}).items():
    output.append(f"[{model_id}'s Rankings]")
    output.append(result.get("content", ""))
    output.append("")

output.append("-" * 70)
output.append("                 PHASE 3: CHAIRMAN'S SYNTHESIS")
output.append("-" * 70)
output.append("")
chairman_name = config.get("chairman", "Chairman")
output.append(f"[{chairman_name} - Chairman]")
output.append("")
output.append(synthesis)
output.append("")
output.append("=" * 70)
output.append(f"Session files: {SESSION_DIR}/")

final_output = "\n".join(output)
with open(f"{SESSION_DIR}/final_output.md", "w", encoding='utf-8') as f:
    f.write(final_output)

print(f"\nFull output saved to: {SESSION_DIR}/final_output.md")
