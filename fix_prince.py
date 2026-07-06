import urllib.request
import json
import urllib.error

URL = "https://gwfjkpsoaoherntwhdyf.supabase.co/rest/v1"
SERVICE = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd3ZmprcHNvYW9oZXJudHdoZHlmIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MzA2MzE5MywiZXhwIjoyMDk4NjM5MTkzfQ.-fZZPCqSty7h4XGHjhBt-HLuljMtnE_EDJn1mf7_rJs"

HEADERS = {
    "apikey": SERVICE,
    "Authorization": f"Bearer {SERVICE}",
    "Content-Type": "application/json",
    "Prefer": "return=representation"
}

try:
    req = urllib.request.Request(f"{URL}/users", headers=HEADERS)
    res = urllib.request.urlopen(req)
    users = json.loads(res.read())
    
    print("All users:")
    for u in users:
        print(u["user_id"], u["email"])
        if "prince" in (u.get("email") or "").lower():
            print("FOUND PRINCE!")
            user_id = u["user_id"]
            
            payload = json.dumps({
                "user_id": user_id,
                "capability_code": "ret_onboarding"
            }).encode("utf-8")
            req2 = urllib.request.Request(f"{URL}/user_capabilities", headers=HEADERS, data=payload, method="POST")
            res2 = urllib.request.urlopen(req2)
            print("Insert result:", res2.status, res2.read().decode())
    
except urllib.error.HTTPError as e:
    print(f"HTTPError: {e.code} - {e.read().decode()}")
