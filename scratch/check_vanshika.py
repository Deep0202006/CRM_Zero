import os
import json
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv(".env.local")
url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
supabase: Client = create_client(url, key)

# Get Vanshika's user_id
user_res = supabase.table('users').select('*').eq('username', 'zerodata502_Vanshika').execute()
if not user_res.data:
    print("User Vanshika not found.")
else:
    user_id = user_res.data[0]['user_id']
    print(f"Vanshika user_id: {user_id}")
    
    # Get total calls
    calls = supabase.table('call_logs').select('*').eq('user_id', user_id).execute()
    print(f"Total calls for Vanshika: {len(calls.data)}")
    
    # Analyze outcomes
    outcomes = {}
    for c in calls.data:
        out = c.get('outcome', 'None')
        outcomes[out] = outcomes.get(out, 0) + 1
        
    print("Outcomes:", outcomes)
    
    # Are there any followups?
    followups = [c for c in calls.data if c.get('next_followup_date')]
    print(f"Total followups: {len(followups)}")
