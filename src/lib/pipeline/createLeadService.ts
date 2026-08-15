import { db, processSyncQueueExcept, type LocalLead } from "../db";
import { supabase, isSupabaseConfigured } from "../supabaseClient";
import { sendPipelineCreate, type PipelineCreateConfirmation } from "./createClient";
import { PIPELINE_CREATE_QUEUE_TABLE, type PipelineCreateCommand, type PipelineSegment } from "./contract";

export interface NewPipelineLeadInput {
  businessName: string;
  contactPerson: string;
  phone: string;
  segment: PipelineSegment;
  source: string;
  area?: string;
}

function createCommand(input: NewPipelineLeadInput, actorId: string): PipelineCreateCommand {
  const operationId = crypto.randomUUID();
  return {
    operation_id: operationId,
    lead_id: crypto.randomUUID(),
    actor_id: actorId,
    business_name: input.businessName.trim(),
    contact_person: input.contactPerson.trim(),
    phone: input.phone.trim(),
    segment_type: input.segment,
    lead_source: input.source.trim(),
    area: input.area?.trim() || null,
    created_at: new Date().toISOString(),
  };
}

function localLead(command: PipelineCreateCommand): LocalLead {
  return {
    lead_id: command.lead_id,
    business_name: command.business_name,
    contact_person: command.contact_person,
    phone: command.phone,
    segment_type: command.segment_type,
    status: "New",
    assigned_to: command.actor_id,
    created_at: command.created_at,
    stage_entered_at: command.created_at,
    lead_source: command.lead_source,
    area: command.area ?? undefined,
  };
}

async function preserveResult(command: PipelineCreateCommand, result: PipelineCreateConfirmation) {
  const key = `pipeline-create:${command.operation_id}`;
  const item = await db.sync_queue.where("idempotency_key").equals(key).first();
  if (!item?.id) return;
  if (result.status === "confirmed") {
    await db.transaction("rw", [db.leads, db.sync_queue], async () => {
      await db.leads.put(result.lead);
      await db.sync_queue.delete(item.id!);
    });
    return;
  }
  if (result.status === "duplicate" || result.status === "rejected") {
    await db.sync_queue.update(item.id, {
      last_error: result.code,
      recovery_state: "review_required",
      recovery_reason: result.code,
      recovery_marked_at: new Date().toISOString(),
      next_retry_at: undefined,
    });
  }
}

export async function createPipelineLead(input: NewPipelineLeadInput, actorId: string): Promise<PipelineCreateConfirmation> {
  const command = createCommand(input, actorId);
  const key = `pipeline-create:${command.operation_id}`;
  await db.transaction("rw", [db.leads, db.sync_queue], async () => {
    await db.leads.add(localLead(command));
    await db.sync_queue.add({
      idempotency_key: key,
      owner_user_id: actorId,
      table_name: PIPELINE_CREATE_QUEUE_TABLE,
      action: "INSERT",
      data: command,
      timestamp: command.created_at,
    });
  });
  if (typeof navigator === "undefined" || !navigator.onLine || !isSupabaseConfigured) return { status: "pending", code: "PIPELINE_CREATE_OFFLINE" };
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { status: "pending", code: "PIPELINE_CREATE_UNAUTHENTICATED" };
  const result = await sendPipelineCreate(command, token);
  await preserveResult(command, result);
  if (result.status === "pending") void processSyncQueueExcept(key);
  return result;
}
