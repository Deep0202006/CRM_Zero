const { createClient } = require('@supabase/supabase-js');


const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || (!supabaseKey && !supabaseServiceKey)) {
  console.error("Missing Supabase credentials in .env.local");
  process.exit(1);
}

// Use service role key if available for admin privileges
const supabase = createClient(supabaseUrl, supabaseServiceKey || supabaseKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

async function main() {
  console.log("🚀 Starting Final Historical Data Purge (Boundary: <= 2026-07-07 23:59:59 UTC)");
  const cutoffDate = '2026-07-07T23:59:59.999Z';

  try {
    // 1. Task History
    console.log("Purging task_status_history...");
    let { error: e1 } = await supabase.from('task_status_history').delete().lte('changed_at', cutoffDate);
    if (e1) console.error("Error purging task_status_history:", e1);

    // 2. Tasks
    console.log("Purging tasks...");
    let { error: e2 } = await supabase.from('tasks').delete().lte('created_at', cutoffDate);
    if (e2) console.error("Error purging tasks:", e2);

    // 3. Call Logs
    console.log("Purging call_logs...");
    let { error: e3 } = await supabase.from('call_logs').delete().lte('timestamp', cutoffDate);
    if (e3) console.error("Error purging call_logs:", e3);

    // 4. Client Queries
    console.log("Purging client_queries...");
    let { error: e4 } = await supabase.from('client_queries').delete().lte('created_at', cutoffDate);
    if (e4) console.error("Error purging client_queries:", e4);

    // 5. Mapping Requests
    console.log("Purging mapping_requests...");
    let { error: e5 } = await supabase.from('mapping_requests').delete().lte('created_at', cutoffDate);
    if (e5) console.error("Error purging mapping_requests:", e5);

    // 6. Mappings
    console.log("Purging mappings...");
    let { error: e6 } = await supabase.from('mappings').delete().lte('created_at', cutoffDate);
    if (e6) console.error("Error purging mappings:", e6);

    // 7. Pipeline dependencies
    console.log("Purging lead_registration_checklist...");
    let { error: e7 } = await supabase.from('lead_registration_checklist').delete().lte('created_at', cutoffDate);
    if (e7) console.error("Error purging lead_registration_checklist:", e7);

    console.log("Purging lead_installation_details...");
    let { error: e8 } = await supabase.from('lead_installation_details').delete().lte('created_at', cutoffDate);
    if (e8) console.error("Error purging lead_installation_details:", e8);

    console.log("Purging lead_payment_details...");
    let { error: e9 } = await supabase.from('lead_payment_details').delete().lte('created_at', cutoffDate);
    if (e9) console.error("Error purging lead_payment_details:", e9);

    // 8. Leads
    console.log("Purging leads...");
    let { error: e10 } = await supabase.from('leads').delete().lte('created_at', cutoffDate);
    if (e10) console.error("Error purging leads:", e10);

    console.log("✅ Final historical data purge complete.");
  } catch (error) {
    console.error("Fatal error during purge:", error);
  }
}

main();
