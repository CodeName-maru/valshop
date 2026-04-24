-- FR-R1: auth 재설계 스키마
-- Plan: docs/plan/0018_AUTH_DB_SCHEMA_MIGRATION_PLAN.md
-- Spec: docs/superpowers/specs/2026-04-24-auth-redesign-design.md § 4-4

-- 1) user_tokens 확장 — 세션 vault 컬럼 추가
alter table user_tokens
  add column if not exists session_id uuid unique,
  add column if not exists session_expires_at timestamptz,
  add column if not exists ssid_enc text,
  add column if not exists tdid_enc text;

-- 2) 기존 행 삭제 (implicit-grant 시절 토큰 무효)
delete from user_tokens;

-- 3) NOT NULL 승격 (행 없는 상태에서 안전)
alter table user_tokens
  alter column session_id set not null,
  alter column session_expires_at set not null,
  alter column ssid_enc set not null;

-- 4) session_id lookup 인덱스 (O(1) resolve)
create index if not exists user_tokens_session_id_idx
  on user_tokens (session_id);

-- 5) RLS 재확인 (이미 enable 이지만 idempotent 보강)
alter table user_tokens enable row level security;

-- 6) rate_limit_buckets 신설
create table if not exists rate_limit_buckets (
  bucket_key   text primary key,
  count        int not null,
  window_start timestamptz not null
);
alter table rate_limit_buckets enable row level security;
