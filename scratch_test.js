const { createClient } = require('@supabase/supabase-js');

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function test() {
  const { data: users, error: fetchErr } = await supabaseAdmin.from('users').select('*').limit(1);
  if (fetchErr || !users.length) {
    console.error('Failed to fetch user', fetchErr);
    return;
  }
  
  const user = users[0];
  console.log('Testing update on user:', user.user_id, user.email);
  
  // 1. Auth update
  const { error: authErr, data } = await supabaseAdmin.auth.admin.updateUserById(user.user_id, {
    email: user.email,
    email_confirm: true,
    user_metadata: { name: user.name + ' modified' }
  });
  
  if (authErr) {
    console.error('Auth update error:', authErr);
  } else {
    console.log('Auth update success', data.user.id);
  }
  
  // 2. DB update
  const { error: dbErr } = await supabaseAdmin.from('users').update({
    name: user.name + ' modified'
  }).eq('user_id', user.user_id);
  
  if (dbErr) {
    console.error('DB update error:', dbErr);
  } else {
    console.log('DB update success');
  }
}

test();
