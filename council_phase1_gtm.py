import os
import json
import requests
import time

API_KEY = "freellmapi-b2397ee851321aaf9d9fae868c4d1eb0babb9a1f331aa016"
API_URL = "http://localhost:5173/v1/chat/completions"

QUERY = """
Run the council on this final product synthesis, system engineering, and market-entry execution strategy for the PharmaOrders 2.0 ecosystem. 

Analyze all provided resource assets concurrently, including entity-relationship (ER) diagrams, code repositories contained inside the zipped/rared archives, Markdown (.md) product manuals, PDF documentation, our established Pharmarack alternative architecture, and our operational implementation plans.

### 🎯 Objective: Finalize the Technical Blueprint and GTM Strategy for PharmaOrders 2.0

Synthesize multi-disciplinary insights by adopting three distinct perspectives: a **Senior Software Architect**, a **Marketing Director**, and a **Field Sales Manager** to ensure the software achieves unmatched user friendliness, bulletproof engineering, and immediate commercial traction among non-technical users.

---

### 1. The Senior Software Architect Perspective (Engineering Functional Execution)
* **Code & Schema Integration:** Map out the unified system topology needed to turn the raw source file analysis into a completely functional production codebase. 
* **Frictionless UI/UX Backing:** Detail the exact backend routes, caching pipelines (Redis), and event structures required to keep the interface blindingly fast and ultra-simple. Users must never navigate deeper than 3 clicks to complete any core operation (order placement, stock search, or payment logging).
* **Database Blueprint:** Provide the final, production-ready PostgreSQL relational schema mapping out multi-tenant accounts, dynamic item catalogs, batch/expiry controls, order headers, and non-repudiation audit trails.

### 2. The Marketing Manager Perspective (The Core Value Hook)
* **Positioning Our Advantages:** Define how we position our structural advantages over legacy systems like Pharmarack in simple, zero-jargon terms that appeal to local retail pharmacy owners.
* **Highlighting USPs:** Focus on our key points of value:
  * Absolute visibility into smart alternative brand formulations when primary items are out of stock.
  * Transparent, real-time dynamic wholesale schemes ("10+1 free") computed instantly in the basket.
  * Educational/onboarding simplicity that requires zero formal technical literacy.

### 3. The Field Sales Manager Perspective (Frictionless Field Adoption)
* **Empowering Traveling Agents:** Refine the workflow for traveling sales representatives booking orders on behalf of client pharmacies in remote locations.
* **Offline Operation & Ledger Controls:** Standardize the background synchronization and local-caching layers so agents can reliably look up client balances, view credit restrictions, and write new order transactions completely offline, auto-syncing without data duplication once back in cellular range.

---

### 🚨 Council Constraints & Output Rules:
1. Provide comprehensive, production-grade source code snippets, real data model configurations, and final structural files. Do not truncate outputs with pseudo-code comments or summary placeholders.
2. Ensure the code architectures elegantly balance complex, secure multi-tenant isolation rules on the database layer with complete simplicity on the user interface.
"""
MODELS = ["auto", "fusion", "gpt-4.1", "gpt-4"] # replaced gemini-in-antigravity with gpt-4 to avoid model not found

timestamp = time.strftime("%Y%m%d-%H%M%S")
# Save inside the artifacts folder so the agent can read it!
SESSION_DIR = rf"C:\Users\dcp69\.gemini\antigravity-ide\brain\c02b0fd9-260a-43b8-9235-8124b740959b\llm-council-gtm-{timestamp}"
os.makedirs(SESSION_DIR, exist_ok=True)

config = {"query": QUERY, "models": MODELS, "timestamp": timestamp}
with open(f"{SESSION_DIR}/config.json", "w", encoding='utf-8') as f:
    json.dump(config, f, indent=2)

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
                print(f"    [429 Rate Limit on {model_id}] Retrying in 10s...")
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
            print(f"    [Error on {model_id}] {e}. Retrying in 10s...")
            time.sleep(10)

print(f"\n{'='*60}")
print("PHASE 1: Collecting Individual Responses (Sequential with 30s delay)")
print(f"{'='*60}")

results = {}
for idx, m in enumerate(MODELS):
    print(f"Starting {m}...")
    result = call_model(m, QUERY)
    results[m] = result
    status = "OK" if result["success"] else "FAILED"
    print(f"  [{status}] {m} ({result['latency_seconds']}s)")
    
    if idx < len(MODELS) - 1:
        print("Waiting 30 seconds to respect rate boundaries...")
        time.sleep(30)

with open(f"{SESSION_DIR}/phase1_responses.json", "w", encoding='utf-8') as f:
    json.dump(results, f, indent=2, ensure_ascii=False)

print(f"\nPhase 1 complete. Results saved to: {SESSION_DIR}/phase1_responses.json")
with open(r"C:\Users\dcp69\Desktop\CRM_Zero\latest_session_dir.txt", "w") as f:
    f.write(SESSION_DIR)
