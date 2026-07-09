const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing Supabase credentials in environment.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const excelUsersPath = path.join(__dirname, '../src/lib/excel_users.json');
const excelUsers = require(excelUsersPath);

async function fixHistoricData() {
  console.log("Starting historical data update...");

  // 1. Fix Leads (mappings)
  const { data: leads, error: leadsError } = await supabase
    .from('leads')
    .select('lead_id, business_name, contact_person');

  if (leadsError) {
    console.error("Error fetching leads:", leadsError);
  } else {
    let leadsUpdated = 0;
    for (const lead of leads) {
      // Find matching user from excel users
      // If it already starts with '[', it might be fine, but let's re-format just in case
      let newName = null;
      let matchedU = null;
      
      const match = excelUsers.find(u => 
         lead.business_name.includes(u.name) || 
         lead.business_name.includes(u.username) || 
         lead.business_name === u.name
      );

      if (match) {
        newName = `[${match.username}] - ${match.name || match.username}`;
      }

      if (newName && newName !== lead.business_name) {
        const { error: updateError } = await supabase
          .from('leads')
          .update({ 
            business_name: newName, 
            contact_person: lead.contact_person === lead.business_name ? newName : lead.contact_person 
          })
          .eq('lead_id', lead.lead_id);
        
        if (updateError) {
          console.error(`Failed to update lead ${lead.lead_id}:`, updateError);
        } else {
          leadsUpdated++;
        }
      }
    }
    console.log(`Updated ${leadsUpdated} out of ${leads.length} leads.`);
  }

  // 2. Fix Client Queries
  const { data: queries, error: queriesError } = await supabase
    .from('client_queries')
    .select('query_id, client_name, client_username');

  if (queriesError) {
    console.error("Error fetching client queries:", queriesError);
  } else {
    let queriesUpdated = 0;
    for (const q of queries) {
      let newName = null;
      let newUsername = q.client_username;

      const match = excelUsers.find(u => 
         q.client_name.includes(u.name) || 
         q.client_name.includes(u.username) || 
         q.client_name === u.name
      );

      if (match) {
        newName = `[${match.username}] - ${match.name || match.username}`;
        newUsername = match.username;
      } else if (q.client_username && q.client_username !== 'UNKNOWN') {
        const rawName = q.client_name === q.client_username ? "Unknown Client" : q.client_name.replace(` (@${q.client_username})`, '');
        newName = `[${q.client_username}] - ${rawName}`;
      }

      if (newName && newName !== q.client_name) {
        const { error: updateError } = await supabase
          .from('client_queries')
          .update({ client_name: newName, client_username: newUsername })
          .eq('query_id', q.query_id);
        
        if (updateError) {
          console.error(`Failed to update query ${q.query_id}:`, updateError);
        } else {
          queriesUpdated++;
        }
      }
    }
    console.log(`Updated ${queriesUpdated} out of ${queries.length} client queries.`);
  }

  console.log("Historical data update completed.");
}

fixHistoricData().catch(console.error);
