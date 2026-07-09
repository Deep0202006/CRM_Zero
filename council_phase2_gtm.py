import os
import json
import requests
import time

API_KEY = "freellmapi-b2397ee851321aaf9d9fae868c4d1eb0babb9a1f331aa016"
API_URL = "http://localhost:5173/v1/chat/completions"

with open(r"C:\Users\dcp69\Desktop\CRM_Zero\latest_session_dir.txt", "r") as f:
    SESSION_DIR = f.read().strip()

with open(f"{SESSION_DIR}/config.json", encoding='utf-8') as f:
    config = json.load(f)
with open(f"{SESSION_DIR}/phase1_responses.json", encoding='utf-8') as f:
    phase1_results = json.load(f)

QUERY = config["query"]
MODELS = config["models"]

labels = ["A", "B", "C", "D", "E"][:len(MODELS)]
model_to_label = dict(zip(MODELS, labels))
label_to_model = {v: k for k, v in model_to_label.items()}

anonymized_responses = []
for model_id in MODELS:
    label = model_to_label[model_id]
    content = phase1_results[model_id]["content"]
    anonymized_responses.append(f"=== Response {label} ===\n{content}")

anonymized_text = "\n\n".join(anonymized_responses)

def get_rankings(model_id, query, anonymized, own_label, retries=3):
    ranking_prompt = f"QUERY: {query}\n\nAnonymized responses:\n{anonymized}\n\nRank these responses from BEST to WORST. State the response letter and a brief reason. Format as:\nRANKINGS:\n1. [Letter] - [Reason]"
    for attempt in range(retries):
        try:
            start = time.time()
            response = requests.post(
                API_URL,
                headers={"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"},
                json={
                    "model": model_id,
                    "messages": [
                        {"role": "system", "content": f"You are ranking AI responses objectively. Your own response is labeled '{own_label}'."},
                        {"role": "user", "content": ranking_prompt}
                    ],
                    "max_tokens": 1000,
                    "temperature": 0.5
                }
            )
            if response.status_code == 429 and attempt < retries - 1:
                print(f"    [429 Rate Limit on {model_id}] Retrying in 10s...")
                time.sleep(10)
                continue
            response.raise_for_status()
            return {
                "success": True,
                "content": response.json()["choices"][0]["message"]["content"],
                "model": model_id,
                "latency_seconds": round(time.time() - start, 2)
            }
        except Exception as e:
            if attempt == retries - 1: return {"success": False, "content": f"[ERROR: {str(e)}]", "model": model_id, "latency_seconds": 0}
            print(f"    [Error on {model_id}] {e}. Retrying in 10s...")
            time.sleep(10)

print(f"\nPHASE 2: Cross-Model Ranking (Sequential with 30s delay)")
rankings = {}
for idx, mid in enumerate(MODELS):
    print(f"Starting ranking for {mid}...")
    result = get_rankings(mid, QUERY, anonymized_text, model_to_label[mid])
    rankings[mid] = result
    status = "OK" if result["success"] else "FAILED"
    print(f"  [{status}] {mid} ({result['latency_seconds']}s)")
    
    if idx < len(MODELS) - 1:
        print("Waiting 30 seconds to respect rate boundaries...")
        time.sleep(30)

output = {"label_mapping": label_to_model, "model_to_label": model_to_label, "rankings": rankings}
with open(f"{SESSION_DIR}/phase2_rankings.json", "w", encoding='utf-8') as f:
    json.dump(output, f, indent=2, ensure_ascii=False)
print(f"\nPhase 2 complete.")
