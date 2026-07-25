import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import * as xlsx from 'xlsx';

// Initialize Supabase admin client to bypass RLS for server-authoritative reporting
// We must verify the user's role before processing
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const token = url.searchParams.get('token');

    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Authenticate the requesting user securely using Supabase
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Verify user is an admin
    const { data: userData, error: userError } = await supabaseAdmin
      .from('users')
      .select('is_active')
      .eq('user_id', user.id)
      .single();

    if (userError || !userData || !userData.is_active) {
       return NextResponse.json({ error: 'Unauthorized or inactive user' }, { status: 403 });
    }

    const { data: caps, error: capsError } = await supabaseAdmin
      .from('user_capabilities')
      .select('capability_code')
      .eq('user_id', user.id);
      
    if (capsError) {
      return NextResponse.json({ error: 'Failed to verify capabilities' }, { status: 500 });
    }

    const isAdmin = caps.some(c => c.capability_code === 'admin');
    if (!isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Extract filters
    const dateFrom = url.searchParams.get('dateFrom');
    const dateTo = url.searchParams.get('dateTo');
    const outcome = url.searchParams.get('outcome');
    const agent = url.searchParams.get('agent');

    // Query field visits joining users and leads
    let query = supabaseAdmin
      .from('field_visits')
      .select(`
        visit_id,
        visit_date,
        check_in_time,
        check_in_lat,
        check_in_lng,
        location_accuracy_m,
        location_captured_at,
        location_acquisition_mode,
        location_quality,
        selfie_captured_at,
        selfie_capture_method,
        selfie_storage_path,
        visit_outcome,
        visit_notes,
        person_met,
        segment_type,
        follow_up_date,
        attendance_id,
        created_at,
        users:user_id ( user_id, email, name ),
        leads:lead_id ( lead_id, business_name, contact_person, phone )
      `)
      .order('created_at', { ascending: false });

    if (dateFrom) query = query.gte('visit_date', dateFrom);
    if (dateTo) query = query.lte('visit_date', dateTo);
    if (outcome && outcome !== 'ALL') query = query.eq('visit_outcome', outcome);
    if (agent && agent !== 'ALL') query = query.eq('user_id', agent);

    const { data: visits, error: dbError } = await query;

    if (dbError) {
      console.error('Error fetching visits for export:', dbError);
      return NextResponse.json({ error: 'Database query failed' }, { status: 500 });
    }

    // Process data for Excel
    const rows = visits.map((v: unknown) => {
      const visit = v as {
        visit_id: string;
        visit_date: string;
        check_in_time: string;
        users?: { name: string; email: string };
        leads?: { business_name: string; contact_person: string; phone: string };
        segment_type: string;
        person_met: string;
        visit_outcome: string;
        visit_notes: string;
        follow_up_date: string;
        check_in_lat: number;
        check_in_lng: number;
        location_accuracy_m: number;
        location_quality: string;
        selfie_captured_at: string;
        selfie_storage_path: string;
        attendance_id: string;
      };
      return {
      'Visit ID': visit.visit_id,
      'Visit Date': visit.visit_date,
      'Check-in Time': new Date(visit.check_in_time).toLocaleString(),
      'Agent Name': visit.users?.name || 'Unknown',
      'Agent Email': visit.users?.email || 'Unknown',
      'Business Name': visit.leads?.business_name || 'Unknown',
      'Contact Person': visit.leads?.contact_person || 'Unknown',
      'Phone': visit.leads?.phone || 'Unknown',
      'Segment Type': visit.segment_type,
      'Person Met': visit.person_met,
      'Outcome': visit.visit_outcome,
      'Notes': visit.visit_notes,
      'Follow-up Date': visit.follow_up_date,
      'Latitude': visit.check_in_lat,
      'Longitude': visit.check_in_lng,
      'Loc Accuracy (m)': visit.location_accuracy_m,
      'Loc Quality': visit.location_quality,
      'Selfie Captured At': visit.selfie_captured_at ? new Date(visit.selfie_captured_at).toLocaleString() : '',
      'Selfie Path': visit.selfie_storage_path,
      'Attendance ID': visit.attendance_id,
    };
    });

    // Create Excel workbook
    const worksheet = xlsx.utils.json_to_sheet(rows);
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, worksheet, 'Field Visits');

    // Generate buffer
    const buf = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    // Return as downloadable file
    return new NextResponse(buf, {
      status: 200,
      headers: {
        'Content-Disposition': `attachment; filename="FieldVisitsExport_${new Date().toISOString().split('T')[0]}.xlsx"`,
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
    });

  } catch (err: unknown) {
    console.error('Export error:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
