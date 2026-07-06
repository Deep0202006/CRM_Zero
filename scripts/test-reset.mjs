import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://gwfjkpsoaoherntwhdyf.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd3ZmprcHNvYW9oZXJudHdoZHlmIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MzA2MzE5MywiZXhwIjoyMDk4NjM5MTkzfQ.-fZZPCqSty7h4XGHjhBt-HLuljMtnE_EDJn1mf7_rJs';
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  console.log("Finding admin user...");
  const { data: caps, error: capsError } = await supabase
    .from('user_capabilities')
    .select('user_id')
    .eq('capability_code', 'admin');

  if (capsError) {
    console.error('Error fetching admin caps:', capsError);
    return;
  }
  
  if (!caps || !caps.length) {
    console.log('No admin found in user_capabilities.');
    return;
  }

  const adminId = caps[0].user_id;
  const tempPassword = 'NewPassword789!';
  
  console.log(`Resetting password using updateUserById with user_metadata...`);
  const { data, error } = await supabase.auth.admin.updateUserById(adminId, { 
    password: tempPassword,
    user_metadata: { must_change_password: true }
  });
  
  if (error) {
    console.error('Error updating password:', error.message);
  } else {
    console.log('Successfully reset admin password to: ' + tempPassword);
    
    // Now let's test if we can login with the new password
    console.log("Testing login with new password...");
    const { data: loginData, error: loginError } = await supabase.auth.signInWithPassword({
        // wait, I don't know the admin's email easily. I can fetch it:
        email: data.user.email,
        password: tempPassword
    });

    if (loginError) {
        console.error("Login failed:", loginError.message);
    } else {
        console.log("Login successful! Token:", loginData.session.access_token.slice(0, 10) + "...");
    }
  }
}

run();
