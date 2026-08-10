-- Team Chat V1: additive schema only.
-- REVIEW GATE: do not apply to production without explicit owner approval.

create extension if not exists pgcrypto;

create table if not exists public.chat_conversations (
  conversation_id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('team', 'dm')),
  title text,
  dm_key text unique,
  created_by uuid references public.users(user_id) on delete restrict,
  created_at timestamptz not null default now(),
  last_message_at timestamptz,
  constraint chat_conversations_shape check (
    (kind = 'team' and dm_key is null and title is not null)
    or (kind = 'dm' and dm_key is not null and title is null)
  )
);

create unique index if not exists chat_one_team_room
  on public.chat_conversations (kind) where kind = 'team';

create table if not exists public.chat_members (
  conversation_id uuid not null references public.chat_conversations(conversation_id) on delete restrict,
  user_id uuid not null references public.users(user_id) on delete restrict,
  joined_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create index if not exists chat_members_user_conversation
  on public.chat_members (user_id, conversation_id);

create table if not exists public.chat_messages (
  message_id uuid primary key,
  conversation_id uuid not null references public.chat_conversations(conversation_id) on delete restrict,
  sender_id uuid not null references public.users(user_id) on delete restrict,
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default now()
);

create index if not exists chat_messages_conversation_created
  on public.chat_messages (conversation_id, created_at desc, message_id desc);

create table if not exists public.chat_read_state (
  conversation_id uuid not null references public.chat_conversations(conversation_id) on delete restrict,
  user_id uuid not null references public.users(user_id) on delete restrict,
  last_read_message_id uuid references public.chat_messages(message_id) on delete restrict,
  read_through_created_at timestamptz not null default 'epoch'::timestamptz,
  updated_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create index if not exists chat_read_state_user
  on public.chat_read_state (user_id, conversation_id);

create table if not exists public.chat_push_subscriptions (
  subscription_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(user_id) on delete restrict,
  endpoint text not null unique,
  p256dh text not null,
  auth_secret text not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  enabled boolean not null default true
);

create index if not exists chat_push_subscriptions_user_enabled
  on public.chat_push_subscriptions (user_id, enabled);

alter table public.chat_conversations enable row level security;
alter table public.chat_members enable row level security;
alter table public.chat_messages enable row level security;
alter table public.chat_read_state enable row level security;
alter table public.chat_push_subscriptions enable row level security;

create or replace function public.chat_is_active_user(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.users u
    where u.user_id = p_user_id and u.is_active = true
  );
$$;

create or replace function public.chat_is_member(p_conversation_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.chat_is_active_user(p_user_id) and exists (
    select 1 from public.chat_members m
    where m.conversation_id = p_conversation_id and m.user_id = p_user_id
  );
$$;

revoke all on function public.chat_is_active_user(uuid) from public;
revoke all on function public.chat_is_member(uuid, uuid) from public;
grant execute on function public.chat_is_active_user(uuid) to authenticated;
grant execute on function public.chat_is_member(uuid, uuid) to authenticated;

create policy chat_conversations_member_select
on public.chat_conversations for select to authenticated
using (public.chat_is_member(conversation_id, (select auth.uid())));

create policy chat_members_conversation_select
on public.chat_members for select to authenticated
using (public.chat_is_member(conversation_id, (select auth.uid())));

create policy chat_messages_member_select
on public.chat_messages for select to authenticated
using (public.chat_is_member(conversation_id, (select auth.uid())));

create policy chat_messages_self_insert
on public.chat_messages for insert to authenticated
with check (
  sender_id = (select auth.uid())
  and public.chat_is_member(conversation_id, (select auth.uid()))
);

create policy chat_read_state_self_select
on public.chat_read_state for select to authenticated
using (
  user_id = (select auth.uid())
  and public.chat_is_member(conversation_id, (select auth.uid()))
);

grant select on public.chat_conversations, public.chat_members, public.chat_messages, public.chat_read_state to authenticated;
grant insert (message_id, conversation_id, sender_id, body) on public.chat_messages to authenticated;

create or replace function public.chat_get_or_create_dm(p_other_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_dm_key text;
  v_conversation_id uuid;
begin
  if v_user_id is null or p_other_user_id is null or v_user_id = p_other_user_id then
    raise exception 'Invalid direct-message participants';
  end if;
  if not public.chat_is_active_user(v_user_id) or not public.chat_is_active_user(p_other_user_id) then
    raise exception 'Direct messages require two active employees';
  end if;

  v_dm_key := least(v_user_id::text, p_other_user_id::text) || ':' || greatest(v_user_id::text, p_other_user_id::text);
  perform pg_advisory_xact_lock(hashtextextended(v_dm_key, 0));

  select conversation_id into v_conversation_id
  from public.chat_conversations where dm_key = v_dm_key;

  if v_conversation_id is null then
    insert into public.chat_conversations (kind, dm_key, created_by)
    values ('dm', v_dm_key, v_user_id)
    returning conversation_id into v_conversation_id;

    insert into public.chat_members (conversation_id, user_id)
    values (v_conversation_id, v_user_id), (v_conversation_id, p_other_user_id);
  end if;

  return v_conversation_id;
end;
$$;

revoke all on function public.chat_get_or_create_dm(uuid) from public;
grant execute on function public.chat_get_or_create_dm(uuid) to authenticated;

insert into public.chat_conversations (conversation_id, kind, title, created_by)
values ('00000000-0000-4000-8000-00000000c001', 'team', 'Team', null)
on conflict (conversation_id) do nothing;

insert into public.chat_members (conversation_id, user_id)
select '00000000-0000-4000-8000-00000000c001', u.user_id
from public.users u where u.is_active = true
on conflict (conversation_id, user_id) do nothing;

create or replace function public.chat_add_active_user_to_team()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.is_active = true then
    insert into public.chat_members (conversation_id, user_id)
    values ('00000000-0000-4000-8000-00000000c001', new.user_id)
    on conflict (conversation_id, user_id) do nothing;
  end if;
  return new;
end;
$$;

create trigger chat_active_user_team_membership
after insert or update of is_active on public.users
for each row execute function public.chat_add_active_user_to_team();

create or replace function public.chat_signal_message_insert()
returns trigger
language plpgsql
security definer
set search_path = public, realtime
as $$
begin
  perform realtime.send(
    jsonb_build_object('conversation_id', new.conversation_id, 'message_id', new.message_id),
    'message_created',
    'chat:' || new.conversation_id::text,
    true
  );
  update public.chat_conversations
  set last_message_at = new.created_at
  where conversation_id = new.conversation_id;
  return new;
end;
$$;

create trigger chat_message_insert_signal
after insert on public.chat_messages
for each row execute function public.chat_signal_message_insert();

create or replace function public.chat_topic_conversation_id()
returns uuid
language plpgsql
stable
security definer
set search_path = public, realtime
as $$
declare
  v_topic text := realtime.topic();
begin
  if v_topic !~ '^chat:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    return null;
  end if;
  return substring(v_topic from 6)::uuid;
end;
$$;

revoke all on function public.chat_topic_conversation_id() from public;
grant execute on function public.chat_topic_conversation_id() to authenticated;

create policy chat_private_broadcast_member_select
on realtime.messages for select to authenticated
using (
  realtime.messages.extension = 'broadcast'
  and public.chat_is_member(
    public.chat_topic_conversation_id(),
    (select auth.uid())
  )
);

-- Intentionally no authenticated DELETE grant/policy for any Team Chat table.
-- Intentionally no UPDATE grant/policy for chat_messages.
