const fs = require('fs');

const envFile = fs.readFileSync('.env.local', 'utf-8');
const env = {};
envFile.split('\n').forEach(line => {
    const [key, ...vals] = line.split('=');
    if (key && vals.length > 0) {
        env[key.trim()] = vals.join('=').trim().replace(/['"]/g, '');
    }
});

const url = env['NEXT_PUBLIC_SUPABASE_URL'];
const key = env['SUPABASE_SERVICE_ROLE_KEY'];

async function main() {
    const callsRes = await fetch(`${url}/rest/v1/call_logs?select=user_id,next_followup_date`, {
        headers: { 'apikey': key, 'Authorization': `Bearer ${key}` }
    });
    const calls = await callsRes.json();
    
    const userStats = {};
    calls.forEach(c => {
        if (!userStats[c.user_id]) userStats[c.user_id] = { total: 0, followups: 0 };
        userStats[c.user_id].total++;
        if (c.next_followup_date) userStats[c.user_id].followups++;
    });
    
    console.log(userStats);
}
main().catch(console.error);
