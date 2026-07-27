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
    const userRes = await fetch(`${url}/rest/v1/users?email=ilike.*Vanshika*`, {
        headers: { 'apikey': key, 'Authorization': `Bearer ${key}` }
    });
    const text = await userRes.text();
    try {
        const users = JSON.parse(text);
        if (!Array.isArray(users) || users.length === 0) {
            console.log("User Vanshika not found by email.");
            // let's try by name
            const userRes2 = await fetch(`${url}/rest/v1/users?name=ilike.*Vanshika*`, {
                headers: { 'apikey': key, 'Authorization': `Bearer ${key}` }
            });
            const users2 = await userRes2.json();
            if (!Array.isArray(users2) || users2.length === 0) {
                console.log("User Vanshika not found by name either.");
                return;
            }
            users.push(...users2);
        }
        const userId = users[0].user_id;
        console.log("Vanshika user_id:", userId, users[0].email, users[0].name);
        
        const callsRes = await fetch(`${url}/rest/v1/call_logs?user_id=eq.${userId}`, {
            headers: { 'apikey': key, 'Authorization': `Bearer ${key}` }
        });
        const calls = await callsRes.json();
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
    } catch(e) {
        console.error(e);
    }
}
main().catch(console.error);
