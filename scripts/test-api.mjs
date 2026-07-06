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

  const adminId = caps[0].user_id;
  const tempPassword = 'NewPassword789!';

  // login first to get a token for the API call
  console.log("Logging in as admin...");
  const { data: userRecord } = await supabase.auth.admin.getUserById(adminId);
  const email = userRecord.user.email;
  
  const { data: loginData } = await supabase.auth.signInWithPassword({
    email,
    password: tempPassword
  });
  
  const token = loginData.session.access_token;
  
  console.log("Calling API to reset password...");
  const res = await fetch("http://localhost:3000/api/admin/reset-password", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`
    },
    body: JSON.stringify({ user_id: adminId, password: "NewPassword123!!" })
  });
  
  const data = await res.json();
  console.log("API response status:", res.status);
  console.log("API response data:", data);
  
  console.log("Testing login with new password...");
  const { data: login2, error: err2 } = await supabase.auth.signInWithPassword({
    email,
    password: "NewPassword123!!"
  });
  
  if (err2) {
      console.log("LOGIN FAILED:", err2.message);
  } else {
      console.log("LOGIN SUCCESS! Token:", login2.session.access_token.slice(0, 10));
  }
}

run();
