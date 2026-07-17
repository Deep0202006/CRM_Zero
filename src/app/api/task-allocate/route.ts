import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co",
  process.env.SUPABASE_SERVICE_ROLE_KEY || "BUILD_TIME_PLACEHOLDER_KEY"
);

export async function POST(req: NextRequest) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    if (!process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY === "BUILD_TIME_PLACEHOLDER_KEY") {
      return NextResponse.json({ error: "Server Configuration Error: SUPABASE_SERVICE_ROLE_KEY is missing." }, { status: 500 });
    }

    const { data: { user: caller }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !caller) return NextResponse.json({ error: "Invalid session" }, { status: 401 });

    const { data: callerCaps } = await supabaseAdmin
      .from("user_capabilities").select("capability_code").eq("user_id", caller.id);
    const hasAccess = callerCaps?.some((c: any) => c.capability_code === "admin" || c.capability_code === "task_assigner");
    if (!hasAccess) return NextResponse.json({ error: "Task assigner access required" }, { status: 403 });

    const body = await req.json();
    const { city, assigned_to_user_id, rows, filename, hash, admin_id } = body;

    if (!city || !assigned_to_user_id || !rows || rows.length === 0) {
      return NextResponse.json({ error: "Missing required allocation parameters" }, { status: 400 });
    }

    // Filter rows for the selected city
    const cityRows = rows.filter((row: any) => row.city === city);

    if (cityRows.length === 0) {
      return NextResponse.json({ error: "No matching rows found for the selected city" }, { status: 404 });
    }

    // 1. Create or ensure the Task Upload Batch exists
    // Since file_hash is UNIQUE, we handle potential conflict
    let batchId = null;
    const { data: existingBatch } = await supabaseAdmin
      .from('task_upload_batches')
      .select('id')
      .eq('file_hash', hash)
      .single();

    if (existingBatch) {
      batchId = existingBatch.id;
    } else {
      const { data: newBatch, error: batchError } = await supabaseAdmin
        .from('task_upload_batches')
        .insert({
          uploaded_by: admin_id || caller.id,
          filename: filename,
          file_hash: hash
        })
        .select()
        .single();

      if (batchError) {
         return NextResponse.json({ error: "Failed to register upload batch", details: batchError.message }, { status: 500 });
      }
      batchId = newBatch.id;
    }

    // 2. Map payload for allocated_targets
    const targetsToInsert = cityRows.map((row: any) => ({
      batch_id: batchId,
      assigned_to_user_id,
      target_legal_name: row.target_legal_name,
      target_username: row.target_username,
      target_phone_number: row.target_phone_number,
      city: row.city,
      is_completed: false
    }));

    // 3. Perform bulk insert (Supabase processes this as a single atomic transaction)
    const { error: insertError } = await supabaseAdmin
      .from('allocated_targets')
      .insert(targetsToInsert);

    if (insertError) {
      return NextResponse.json({ error: "Failed to allocate targets", details: insertError.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      allocatedCount: targetsToInsert.length,
      city
    });

  } catch (error: any) {
    console.error("Error allocating tasks:", error);
    return NextResponse.json(
      { error: "Failed to allocate tasks", details: error.message },
      { status: 500 }
    );
  }
}
