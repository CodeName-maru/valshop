-- Migration 0005: wishlist 보강 (Plan 0016)
-- 기존 0002_wishlist.sql 가 이미 테이블을 생성한 환경 + 신규 환경 모두 멱등.
-- 추가 보조 인덱스 idx_wishlist_skin (skin → user 역조회용, Plan 0008/0013 워커 호환)

create table if not exists wishlist (
  user_id uuid not null references user_tokens(user_id) on delete cascade,
  skin_uuid text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, skin_uuid)
);

create index if not exists idx_wishlist_skin on wishlist(skin_uuid);

alter table wishlist enable row level security;
