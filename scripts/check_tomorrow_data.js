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

async function checkTomorrowData() {
  // Local time is 2026-07-08 +05:30, so tomorrow starts at 2026-07-08T18:30:00.000Z in UTC
  const tomorrowStartUTC = '2026-07-08T18:30:00.000Z';
  
  const tables = ['leads', 'client_queries', 'mappings', 'mapping_requests'];
  let foundAny = false;

  console.log(`Checking for data with created_at >= ${tomorrowStartUTC} (Tomorrow local time)...`);

  for (const table of tables) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .gte('created_at', tomorrowStartUTC);
      
    if (error) {
      console.error(`Error querying ${table}:`, error.message);
      continue;
    }
    
    if (data && data.length > 0) {
      console.log(`\nFound ${data.length} records in ${table} dated tomorrow:`);
      console.log(JSON.stringify(data, null, 2));
      foundAny = true;
    } else {
      console.log(`No tomorrow records in ${table}.`);
    }
  }

  // Also check tasks due tomorrow
  const { data: tasks, error: tasksError } = await supabase
    .from('tasks')
    .select('*')
    .gte('due_date', '2026-07-09');
  
  if (tasks && tasks.length > 0) {
    console.log(`\nFound ${tasks.length} records in tasks with due_date tomorrow or later:`);
    console.log(JSON.stringify(tasks, null, 2));
    foundAny = true;
  }

  if (!foundAny) {
    console.log('\nAll clear! No data dated tomorrow was found in pipeline (leads), query, or mapping.');
  }
}

checkTomorrowData();
