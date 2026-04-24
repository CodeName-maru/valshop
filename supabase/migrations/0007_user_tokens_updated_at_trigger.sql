-- Migration 0007: user_tokens.updated_at 자동 갱신 트리거
-- Plan 0017 P2-#2
-- 근거: user_tokens 행이 UPDATE 될 때 updated_at 컬럼이 자동으로 now() 로 갱신되도록
--       Supabase 표준 확장 moddatetime 트리거를 부착한다.

create extension if not exists moddatetime schema extensions;

drop trigger if exists trg_user_tokens_updated_at on user_tokens;

create trigger trg_user_tokens_updated_at
  before update on user_tokens
  for each row
  execute procedure extensions.moddatetime(updated_at);
