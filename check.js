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
  const { data, error } = await supabaseAdmin.from('allocated_targets').select('*').limit(1);
  if (error) console.error('Allocated Targets Error:', error.message);
  else console.log('Allocated Targets keys:', data && data[0] ? Object.keys(data[0]) : 'Table exists but is empty');

  // count leads
  const { count: leadCount } = await supabaseAdmin.from('leads').select('*', { count: 'exact', head: true });
  console.log('Total Leads:', leadCount);

  // tasks check
  const { count: tasksCount } = await supabaseAdmin.from('tasks').select('*', { count: 'exact', head: true });
  console.log('Total Tasks:', tasksCount);
  
  if (leadCount > 0) {
    console.log('Deleting all leads...');
    await supabaseAdmin.from('leads').delete().neq('lead_id', 'dummy'); // deletes all
  }
  
  if (tasksCount > 0) {
    console.log('Deleting all tasks...');
    await supabaseAdmin.from('tasks').delete().neq('task_id', 'dummy');
  }

  // Check allocated targets
  const { count: allocatedCount } = await supabaseAdmin.from('allocated_targets').select('*', { count: 'exact', head: true });
  console.log('Total Allocated Targets:', allocatedCount);
  
  if (allocatedCount > 0) {
    const { data: atData } = await supabaseAdmin.from('allocated_targets').select('*').limit(5);
    console.log('Allocated targets sample:', atData);
  }
}
run();
