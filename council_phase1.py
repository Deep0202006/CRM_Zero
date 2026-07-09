import os
import json
import requests
import time

API_KEY = "freellmapi-b2397ee851321aaf9d9fae868c4d1eb0babb9a1f331aa016"
API_URL = "http://localhost:5173/v1/chat/completions"

QUERY = """### 🎯 Objective: Deconstruct Pharmarack & Architect a Highly Intuitive, Superior Alternative

---

### 1. Source Material Dissection & Reverse Engineering
* **Data & Code Ingestion:** Analyze all provided entity-relationship (ER) diagrams, zipped and rared source code archives, and Markdown (.md) product manuals representing the legacy Pharmarack system architecture.
* **Extraction Focus:** Map out their primary data schemas, endpoint structures, state-machine transitions for orders, inventory synchronization loops, and role allocations. Identify how they handle multi-distributor carts, credit tracking, and field sales operations.

### 2. Gap Analysis & Vulnerability Identification (Pharmarack Neglected Areas)
* **Pain Point Discovery:** Pinpoint exactly where Pharmarack fails in terms of practical, real-world field solutions, administrative bottlenecks, or complex user friction.
* **Identify Missing Features:** Look for operational gaps in their platform, such as unoptimized order routing, rigid credit limits that freeze fast trades, lack of intuitive alternative molecule matching, poor offline behavior for field reps, or delayed data visibility for managers.

### 3. Engineering a Superior, High-Advantage Feature Set (Our Structural USPs)
Architect an optimized software engine that directly outcompetes the legacy system by providing elegant, practical solutions while enforcing an **absolute simplicity rule**. Our target audience is not technically sound (retail pharmacists, local warehouse packers, traveling salesmen); the underlying architecture must be incredibly robust, but the interface must feel effortless.

Design and detail the following core value engines:
* **Smart Alternative Formulation Discovery:** A feature that instantly presents alternative brands matching the exact generic composition, strength, and form if a requested drug is out of stock.
* **Frictionless Dynamic Wholesale Schemes:** An engine that automatically computes bulk-tier adjustments (e.g., "10+1 free") in the cart in real time without requiring complex manual inputs.
* **Bulletproof Credit & Ledger Automation:** A flexible, risk-managed credit engine allowing seamless micro-adjustments or fast administrative overrides so orders are not locked mid-transit due to minor pending outstanding flags.
* **Zero-Lag Field Sales Offline Mode:** An optimized local-caching layer for traveling agents making bookings in areas with poor cellular connectivity, syncing automatically back to the main ledger once online.

### 4. Technical Architecture Alignment
* **Database & Integrity:** Provide an optimized SQL schema blueprint designed to handle this clean workflow safely, incorporating strict transactional rollbacks and clear role-based boundaries.
* **Simplicity Engineering:** Ensure the frontend routing logic is lightweight, clean, and avoids deeply nested menus or complex corporate jargon.

---

### 🚨 Council Constraints & Output Rules:
1. Deliver comprehensive architectural diagrams (in text/mermaid format), database schema mappings, and core controller code foundations. Do not truncate files with shorthand or placeholder text.
2. The Chairman persona must ensure all features balance massive commercial value with low user friction.
"""

MODELS = ["glm-5.2", "glm-5.1", "auto", "gpt-4.1"]

timestamp = time.strftime("%Y%m%d-%H%M%S")
SESSION_DIR = os.path.join(r"C:\Users\dcp69\.gemini\antigravity-ide\brain\c02b0fd9-260a-43b8-9235-8124b740959b", f"llm-council-{timestamp}")
os.makedirs(SESSION_DIR, exist_ok=True)

config = {"query": QUERY, "models": MODELS + ["gemini"], "timestamp": timestamp}
with open(f"{SESSION_DIR}/config.json", "w", encoding='utf-8') as f:
    json.dump(config, f, indent=2, ensure_ascii=False)

def call_model(model_id, query, retries=3):
    for attempt in range(retries):
        try:
            start = time.time()
            response = requests.post(
                API_URL,
                headers={"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"},
                json={
                    "model": model_id,
                    "messages": [
                        {"role": "system", "content": "You are participating in an LLM council deliberation. Provide your best, most thoughtful response to the query. Be comprehensive but focused."},
                        {"role": "user", "content": query}
                    ],
                    "max_tokens": 4000,
                    "temperature": 0.7
                },
                timeout=120
            )
            
            if response.status_code == 429 and attempt < retries - 1:
                print(f"  [429] Waiting 10s before retry {attempt+1}/{retries}")
                time.sleep(10)
                continue
                
            response.raise_for_status()
            elapsed = time.time() - start
            data = response.json()
            
            return {
                "success": True,
                "content": data["choices"][0]["message"]["content"],
                "model": model_id,
                "latency_seconds": round(elapsed, 2)
            }
        except Exception as e:
            if attempt == retries - 1:
                return {
                    "success": False,
                    "content": f"[ERROR: {str(e)}]",
                    "model": model_id,
                    "latency_seconds": 0
                }
            print(f"  [Error] {str(e)} Waiting 5s before retry {attempt+1}/{retries}")
            time.sleep(5)

print(f"\n{'='*60}")
print("PHASE 1: Collecting Individual Responses")
print(f"{'='*60}")

results = {}
for i, m in enumerate(MODELS):
    print(f"Calling {m}...")
    result = call_model(m, QUERY)
    results[m] = result
    status = "OK" if result["success"] else "FAILED"
    print(f"  [{status}] {m} ({result['latency_seconds']}s)")
    if i < len(MODELS) - 1:
        print("Waiting 30 seconds before next call...")
        time.sleep(30)

with open(f"{SESSION_DIR}/phase1_responses.json", "w", encoding='utf-8') as f:
    json.dump(results, f, indent=2, ensure_ascii=False)

print(f"\nPhase 1 complete. Results saved to: {SESSION_DIR}/phase1_responses.json")
print(f"SESSION_DIR={SESSION_DIR}")
