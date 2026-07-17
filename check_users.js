const fs = require('fs');
const envFile = fs.readFileSync('.env.local', 'utf8');
const env = {};
envFile.split('\n').forEach(line => {
  if (line.includes('=')) {
    const [key, val] = line.split('=');
    env[key.trim()] = val.trim();
  }
});

const { createClient } = require('@supabase/supabase-js');
const supabaseAdmin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const { data: targets } = await supabaseAdmin.from('allocated_targets').select('assigned_to_user_id').limit(10000);
  
  const counts = {};
  targets.forEach(t => {
    counts[t.assigned_to_user_id] = (counts[t.assigned_to_user_id] || 0) + 1;
  });
  console.log('Targets per user:', counts);
}
run();
