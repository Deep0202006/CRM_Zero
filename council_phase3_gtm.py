import os
import json
import requests
import time

API_KEY = "freellmapi-b2397ee851321aaf9d9fae868c4d1eb0babb9a1f331aa016"
API_URL = "http://localhost:5173/v1/chat/completions"

with open(r"C:\Users\dcp69\Desktop\CRM_Zero\latest_session_dir.txt", "r") as f:
    SESSION_DIR = f.read().strip()

CHAIRMAN_MODEL = "gpt-4.1"

with open(f"{SESSION_DIR}/config.json", encoding='utf-8') as f:
    config = json.load(f)
with open(f"{SESSION_DIR}/phase1_responses.json", encoding='utf-8') as f:
    phase1 = json.load(f)
with open(f"{SESSION_DIR}/phase2_rankings.json", encoding='utf-8') as f:
    phase2 = json.load(f)

QUERY = config["query"]
model_to_label = phase2["model_to_label"]

responses_text = []
for model_id, result in phase1.items():
    label = model_to_label.get(model_id, "?")
    responses_text.append(f"=== {label}: {model_id} ===\n{result['content']}")

rankings_text = []
for model_id, result in phase2["rankings"].items():
    rankings_text.append(f"[{model_id}'s Rankings]\n{result['content']}")

synthesis_prompt = f"ORIGINAL QUERY:\n{QUERY}\n\nINDIVIDUAL RESPONSES:\n{chr(10).join(responses_text)}\n\nMODEL RANKINGS:\n{chr(10).join(rankings_text)}\n\nProduce a FINAL SYNTHESIS that incorporates the best elements and provides the ultimate blueprint and GTM strategy answering all requirements."

print(f"\nPHASE 3: Chairman Synthesis ({CHAIRMAN_MODEL})")

try:
    start = time.time()
    response = requests.post(
        API_URL,
        headers={"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"},
        json={
            "model": CHAIRMAN_MODEL,
            "messages": [
                {"role": "system", "content": "You are the Chairman of an LLM Council representing a Software Architect, a Marketing Director, and a Field Sales Manager. Synthesize multiple AI perspectives into a definitive, comprehensive GTM and technical blueprint response."},
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
