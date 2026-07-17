import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";

export async function POST(req: NextRequest) {
  try {
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

    // Note: In an offline-first architecture, you might also want to push this to the 
    // client's Dexie store. But since this is a server endpoint, we push to Supabase directly.
    // The clients will pull it down via Realtime / Sync process.

    // 1. Create or ensure the Task Upload Batch exists
    // Since file_hash is UNIQUE, we handle potential conflict
    let batchId = null;
    const { data: existingBatch } = await supabase
      .from('task_upload_batches')
      .select('id')
      .eq('file_hash', hash)
      .single();

    if (existingBatch) {
      batchId = existingBatch.id;
    } else {
      const { data: newBatch, error: batchError } = await supabase
        .from('task_upload_batches')
        .insert({
          uploaded_by: admin_id,
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
    const { error: insertError } = await supabase
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
