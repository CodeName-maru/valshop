-- Migration 0001: user_tokens table (Riot access/refresh/entitlements 암호화 저장)
-- Plan 0002 / ARCHITECTURE.md § 5 — ADR-0002 하이브리드 정책 (토큰은 AES-GCM, DB 저장)
-- RLS enabled, policy matches auth.uid() 이지만 본 프로젝트는 Riot 비공식 auth 라 service_role 로만 접근한다.

create table if not exists user_tokens (
  user_id uuid primary key default gen_random_uuid(),
  puuid text unique not null,
  access_token_enc bytea not null,
  refresh_token_enc bytea not null,
  entitlements_jwt_enc bytea not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table user_tokens enable row level security;
-- service_role 은 RLS 를 우회하므로 placeholder 정책만 둔다
create policy "service_role only" on user_tokens for all using (false);
