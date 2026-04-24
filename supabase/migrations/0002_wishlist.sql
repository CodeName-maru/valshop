-- Migration 0002: wishlist table (유저별 찜한 스킨 uuid 목록)
-- Plan 0007 / ARCHITECTURE.md § 5

create table if not exists wishlist (
  user_id uuid not null references user_tokens(user_id) on delete cascade,
  skin_uuid text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, skin_uuid)
);

create index if not exists idx_wishlist_user on wishlist(user_id);

alter table wishlist enable row level security;
create policy "service_role only" on wishlist for all using (false);
