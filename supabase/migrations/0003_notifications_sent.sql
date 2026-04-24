-- Migration 0003: notifications_sent table
-- Plan 0008: Store Polling Worker & Email Notifications
-- Purpose: Track sent notifications to prevent duplicates within same rotation

create table if not exists notifications_sent (
  user_id uuid not null,
  skin_uuid text not null,
  rotation_date date not null,
  sent_at timestamptz default now(),
  primary key (user_id, skin_uuid, rotation_date)
);

-- Enable RLS (though worker uses service role key)
alter table notifications_sent enable row level security;

-- Policy: users can only see their own notification history
create policy "Users can view own notifications" on notifications_sent
  for select using (auth.uid() = user_id);

-- Policy: no direct insert from client (worker uses service role)
create policy "No direct insert" on notifications_sent
  for insert with check (false);

-- Policy: no direct delete from client
create policy "No direct delete" on notifications_sent
  for delete using (false);

-- Index for worker queries by user
create index idx_notifications_sent_user on notifications_sent(user_id);

-- Index for cleanup queries by date
create index idx_notifications_sent_date on notifications_sent(rotation_date);

-- Add comment
comment on table notifications_sent is 'Tracks sent email notifications to prevent duplicates within same rotation';
comment on column notifications_sent.rotation_date is 'KST rotation date (Riot store rotates at 00:00 KST)';
