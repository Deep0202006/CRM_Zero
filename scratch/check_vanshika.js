import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function main() {
    const { data: users, error: userErr } = await supabase.from('users').select('*').eq('username', 'zerodata502_Vanshika');
    if (userErr) {
        console.error(userErr);
        return;
    }
    if (!users || users.length === 0) {
        console.log("User Vanshika not found.");
        return;
    }
    const userId = users[0].user_id;
    console.log("Vanshika user_id:", userId);
    
    const { data: calls, error: callsErr } = await supabase.from('call_logs').select('*').eq('user_id', userId);
    if (callsErr) {
        console.error(callsErr);
        return;
    }
    console.log(`Total calls for Vanshika: ${calls.length}`);
    
    const outcomes = {};
    const followups = [];
    calls.forEach(c => {
        const out = c.outcome || 'None';
        outcomes[out] = (outcomes[out] || 0) + 1;
        if (c.next_followup_date) {
            followups.push(c);
        }
    });
    console.log("Outcomes:", outcomes);
    console.log(`Total followups: ${followups.length}`);
}

main().catch(console.error);
