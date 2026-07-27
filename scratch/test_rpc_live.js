const fs = require('fs');
const envFile = fs.readFileSync('.env.local', 'utf-8');
const env = {};
envFile.split('\n').forEach(line => {
    const [key, ...vals] = line.split('=');
    if (key && vals.length > 0) env[key.trim()] = vals.join('=').trim().replace(/['"]/g, '');
});
const url = env['NEXT_PUBLIC_SUPABASE_URL'];
const key = env['SUPABASE_SERVICE_ROLE_KEY'];
async function main() {
    const today = new Date().toISOString().slice(0,10);
    const res = await fetch(`${url}/rest/v1/rpc/get_team_kpi_daily`, {
        method: 'POST',
        headers: { 'apikey': key, 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_date: today })
    });
    const data = await res.json();
    console.log(JSON.stringify(data, null, 2));
}
main().catch(console.error);
