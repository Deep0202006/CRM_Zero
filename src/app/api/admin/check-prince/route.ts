import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabaseClient';

export async function GET() {
  const { data: user } = await supabase.from('users').select('*').eq('email', 'prince@zerodata.com').single();
  if (!user) return NextResponse.json({ error: 'Prince not found' });
  const { data: caps } = await supabase.from('user_capabilities').select('*').eq('user_id', user.user_id);
  return NextResponse.json({ user, caps });
}
