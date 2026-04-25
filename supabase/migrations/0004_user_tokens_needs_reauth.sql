-- Migration 0004: Add needs_reauth flag to user_tokens
-- Plan 0008: Store Polling Worker & Email Notifications
-- Purpose: Track users who need to re-authenticate due to token expiry

alter table user_tokens
  add column if not exists needs_reauth boolean not null default false;

-- Add index for worker queries (filter users who don't need reauth)
create index if not exists idx_user_tokens_needs_reauth
  on user_tokens(needs_reauth)
  where needs_reauth = false;

-- Add comment
comment on column user_tokens.needs_reauth is 'Flag indicating user needs to re-authenticate (set by worker on 401)';
