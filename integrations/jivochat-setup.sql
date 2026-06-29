-- ============================================================================
-- Brick's & Joy — JivoChat in-app inbox tables
-- Run this once in Supabase → SQL Editor.
-- Stores Instagram / Facebook DMs so they can be read & replied to in-app.
-- ============================================================================

-- One row per conversation (client) coming from JivoChat
create table if not exists chat_threads (
  id            text primary key,          -- JivoChat chat_id
  client_id     text,                      -- JivoChat client_id (needed to reply)
  client_name   text,
  channel       text,                      -- 'instagram' | 'facebook' | 'telegram' | ...
  avatar_url    text,
  last_message  text,
  last_at       timestamptz default now(),
  unread        int default 0,
  created_at    timestamptz default now()
);

-- Every individual message in a thread
create table if not exists chat_messages (
  id          bigint generated always as identity primary key,
  thread_id   text references chat_threads(id) on delete cascade,
  direction   text not null,               -- 'in' (from client) | 'out' (our reply)
  sender_name text,
  body        text,
  msg_type    text default 'TEXT',
  created_at  timestamptz default now()
);

create index if not exists idx_chat_messages_thread on chat_messages(thread_id, created_at);
create index if not exists idx_chat_threads_last on chat_threads(last_at desc);

-- Row Level Security: logged-in staff can read/write everything.
alter table chat_threads  enable row level security;
alter table chat_messages enable row level security;

drop policy if exists "staff_all_threads"  on chat_threads;
drop policy if exists "staff_all_messages" on chat_messages;
create policy "staff_all_threads"  on chat_threads  for all using (auth.role() = 'authenticated');
create policy "staff_all_messages" on chat_messages for all using (auth.role() = 'authenticated');

-- Enable Supabase Realtime so the inbox updates live.
alter publication supabase_realtime add table chat_threads;
alter publication supabase_realtime add table chat_messages;
