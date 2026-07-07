const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// Parse .env.local manually
const envPath = path.join(__dirname, '.env.local');
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

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing Supabase credentials in .env.local");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function wipeData() {
  console.log("Wiping dummy user data from Supabase (preserving templates, etc.)...");
  
  const tables = [
    { name: 'task_status_history', pk: 'id', isUuid: false },
    { name: 'tasks', pk: 'task_id', isUuid: true },
    { name: 'call_logs', pk: 'log_id', isUuid: true },
    { name: 'client_queries', pk: 'query_id', isUuid: true },
    { name: 'mappings', pk: 'mapping_id', isUuid: true },
    { name: 'mapping_requests', pk: 'request_id', isUuid: true },
    { name: 'lead_registration_checklist', pk: 'checklist_id', isUuid: true },
    { name: 'lead_installation_details', pk: 'installation_id', isUuid: true },
    { name: 'lead_payment_details', pk: 'payment_id', isUuid: true },
    { name: 'leads', pk: 'lead_id', isUuid: true }
  ];

  for (const table of tables) {
    try {
      let query = supabase.from(table.name).delete();
      if (table.isUuid) {
        query = query.neq(table.pk, '00000000-0000-0000-0000-000000000000');
      } else {
        query = query.gte(table.pk, 0); // numeric or serial pk
      }
      const { error } = await query;
      if (error) throw error;
      console.log(`- Wiped table: ${table.name}`);
    } catch (err) {
      console.error(`- Failed to wipe table: ${table.name} - ${err.message}`);
    }
  }
  
  console.log("Data wipe complete.");
}

wipeData();
