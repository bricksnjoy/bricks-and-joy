-- ============================================================================
-- Brick's & Joy — record of every message the shop sends
-- Run once in Supabase → SQL Editor. Safe to run more than once.
--
-- Every email and SMS is written here as it is sent, whether it succeeded or
-- not, so the Message Center can show what actually went out, what failed and
-- why, and how many SMS parts have been used (which is what the gateway bills).
-- ============================================================================

create table if not exists message_log (
  id uuid primary key default gen_random_uuid(),
  channel text not null,             -- 'email' | 'sms'
  recipient text,                    -- address or number it was sent to
  recipient_name text,
  subject text,                      -- email subject, blank for SMS
  preview text,                      -- first part of the body, for the list
  chars int default 0,               -- message length
  segments int default 0,            -- SMS parts used (1 for email)
  unicode boolean default false,     -- SMS sent as Unicode (70 chars a part)
  ok boolean default false,          -- did it leave successfully
  error text,                        -- why not, when it didn't
  route text,                        -- 'resend' | 'emailjs' | 'messageowl'
  context text,                      -- what it was about, e.g. 'Delivery note'
  sent_by text,                      -- signed-in user who sent it
  created_at timestamptz default now()
);

create index if not exists message_log_created_idx on message_log (created_at desc);
create index if not exists message_log_channel_idx on message_log (channel, created_at desc);

alter table message_log enable row level security;
drop policy if exists "staff_all_message_log" on message_log;
create policy "staff_all_message_log" on message_log
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
