import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const token = url.searchParams.get('token');
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: caps, error: capsError } = await supabaseAdmin
      .from('user_capabilities')
      .select('capability_code')
      .eq('user_id', user.id);
    if (capsError) return NextResponse.json({ error: 'Failed to verify capabilities' }, { status: 500 });

    const isAdmin = caps.some(c => c.capability_code === 'admin');
    if (!isAdmin) return NextResponse.json({ error: 'Admin access required' }, { status: 403 });

    const { data: visits, error: dbError } = await supabaseAdmin
      .from('field_visits')
      .select("*, users:user_id ( name, email ), leads:lead_id ( business_name, contact_person, phone )")
      .order('created_at', { ascending: false });

    if (dbError) return NextResponse.json({ error: 'Database error' }, { status: 500 });

    return NextResponse.json({ visits });
  } catch (err) {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}