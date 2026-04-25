/**
 * Resolve user_id from session payload (puuid → user_id)
 *
 * Plan 0016: Plan 0011 의 AES-GCM cookie 세션은 puuid 만 보장한다.
 * user_tokens 테이블에서 puuid → user_id 를 lookup 하고 60초 LRU 캐시.
 *
 * TODO(Plan 0001 Supabase Auth 통합): Auth user 가 생기면 RLS auth.uid()
 * 로 직접 본인성 검증이 가능하므로 본 helper 와 Service Role 의존을 제거.
 */

/* eslint-disable @typescript-eslint/no-deprecated -- resolveUserIdFromSession 는 MVP cookie 세션(SessionPayload)을 입력으로 받음. ResolvedSession 으로의 전환은 ADR-0002 Phase 2 에서 Auth user 통합 시 본 helper 자체를 제거 예정. */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SessionPayload } from "@/lib/session/types";

interface CacheEntry {
  userId: string | null;
  expiresAt: number; // ms epoch
}

const TTL_MS = 60_000;
const cache = new Map<string, CacheEntry>();

/**
 * puuid 로 user_id 를 찾는다. 없으면 null.
 */
export async function resolveUserIdFromSession(
  session: SessionPayload,
  supabase: SupabaseClient
): Promise<string | null> {
  const now = Date.now();
  const cached = cache.get(session.puuid);
  if (cached && cached.expiresAt > now) {
    return cached.userId;
  }

  const result = await supabase
    .from("user_tokens")
    .select("user_id")
    .eq("puuid", session.puuid)
    .limit(1)
    .maybeSingle();

  if (result.error) {
    // Supabase 장애는 호출자 (Route Handler) 가 503 으로 매핑
    throw result.error;
  }

  const row = result.data as { user_id?: string } | null;
  const userId = row?.user_id ?? null;
  cache.set(session.puuid, { userId, expiresAt: now + TTL_MS });
  return userId;
}

/** 테스트용 — 캐시 초기화 */
export function _resetResolveUserCache(): void {
  cache.clear();
}
