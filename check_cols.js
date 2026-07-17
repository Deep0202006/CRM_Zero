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
  const { data: cols, error } = await supabaseAdmin.from('users').select('*').limit(1);
  if (cols && cols.length > 0) {
     console.log('Columns:', Object.keys(cols[0]));
     console.log('User sample:', cols[0]);
  }
}
run();
