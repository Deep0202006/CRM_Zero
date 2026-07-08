const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const envPath = path.join(__dirname, '..', '.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');
const envLines = envContent.split('\n');
const envObj = {};
for (const line of envLines) {
  if (line.trim() && !line.startsWith('#')) {
    const [key, ...valueParts] = line.split('=');
    if (key && valueParts.length > 0) {
      envObj[key.trim()] = valueParts.join('=').trim().replace(/^"|"$/g, '').replace(/^'|'$/g, '');
    }
  }
}

const supabaseUrl = envObj['NEXT_PUBLIC_SUPABASE_URL'];
const supabaseKey = envObj['SUPABASE_SERVICE_ROLE_KEY'];
const supabase = createClient(supabaseUrl, supabaseKey);

async function purgeData() {
  const cutoff = '2026-07-07T18:30:00.000Z';
  console.log(`Starting historical data purge for records created BEFORE ${cutoff}`);

  // The order is important to prevent FK errors.
  const tables = [
    { name: 'task_status_history', field: 'changed_at' },
    { name: 'tasks', field: 'created_at' },
    { name: 'call_logs', field: 'timestamp' },
    { name: 'client_queries', field: 'created_at' },
    { name: 'mapping_requests', field: 'created_at' },
    { name: 'mappings', field: 'created_at' },
    { name: 'lead_registration_checklist', field: 'created_at' },
    { name: 'lead_installation_details', field: 'created_at' },
    { name: 'lead_payment_details', field: 'created_at' },
    { name: 'leads', field: 'created_at' }
  ];

  for (const { name, field } of tables) {
    console.log(`Purging ${name}...`);
    const { data, error } = await supabase
      .from(name)
      .delete()
      .lt(field, cutoff);

    if (error) {
      console.error(`Error deleting from ${name}:`, error.message);
    } else {
      console.log(`Successfully executed delete on ${name}`);
    }
  }
  
  console.log('Purge completed.');
}

purgeData();
