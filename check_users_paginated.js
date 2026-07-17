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
  let allTargets = [];
  let start = 0;
  const limit = 1000;
  
  while (true) {
    const { data: targets, error } = await supabaseAdmin.from('allocated_targets').select('assigned_to_user_id').range(start, start + limit - 1);
    if (error) {
      console.error(error);
      break;
    }
    if (!targets || targets.length === 0) break;
    allTargets = allTargets.concat(targets);
    start += limit;
  }
  
  console.log('Total targets fetched:', allTargets.length);
  
  const counts = {};
  allTargets.forEach(t => {
    counts[t.assigned_to_user_id] = (counts[t.assigned_to_user_id] || 0) + 1;
  });
  console.log('Targets per user:', counts);
}
run();
