const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
async function main() {
  const { data } = await supabase.from('users').select('*').eq('email', 'prince@zerodata.com');
  console.log('Users:', data);
  if (data && data.length > 0) {
    const { data: caps } = await supabase.from('user_capabilities').select('*').eq('user_id', data[0].user_id);
    console.log('Caps:', caps);
  }
}
main();
