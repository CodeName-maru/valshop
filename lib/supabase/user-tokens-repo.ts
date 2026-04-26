/**
 * User Tokens Repository
 * Port interface + Supabase adapter for accessing user tokens
 *
 * Plan 0014: PostgREST serializes bytea columns as `\x<hex>` strings on read
 * and accepts the same literal on write. We normalize at this adapter boundary
 * so that domain code (worker / cron / etc.) only ever sees `Uint8Array`.
 *
 * TODO (future plan): Supabase generated types 를 도입하여 `Record<string, unknown>`
 * 기반 normalize 대신 `Database["public"]["Tables"]["user_tokens"]["Row"]` 를
 * 직접 사용하도록 마이그레이션. 현재 PR 범위 밖 (별도 plan 으로 분리 예정).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { UserTokensRow, UserTokenInsert, UpsertTokensInput } from "./types";
import { parseBytea, encodeBytea, BytEaParseError } from "./bytea";

const BYTEA_COLUMNS = [
  "access_token_enc",
  "refresh_token_enc",
  "entitlements_jwt_enc",
] as const;

function normalizeRow(row: Record<string, unknown>): UserTokensRow {
  const out: Record<string, unknown> = { ...row };
  for (const col of BYTEA_COLUMNS) {
    out[col] = parseBytea(row[col], col);
  }
  // Plan 0018: timestamp 컬럼 문자열 → Date 변환
  for (const col of ["expires_at", "created_at", "updated_at", "session_expires_at"]) {
    const val = out[col];
    if (typeof val === "string") {
      out[col] = new Date(val);
    }
  }
  return out as unknown as UserTokensRow;
}

function serializeInsert(row: UserTokenInsert): Record<string, unknown> {
  const expires =
    row.expires_at instanceof Date ? row.expires_at.toISOString() : row.expires_at;
  return {
    puuid: row.puuid,
    access_token_enc: encodeBytea(row.access_token_enc),
    refresh_token_enc: encodeBytea(row.refresh_token_enc),
    entitlements_jwt_enc: encodeBytea(row.entitlements_jwt_enc),
    expires_at: expires,
    needs_reauth: row.needs_reauth ?? false,
  };
}

/**
 * Port interface for user tokens repository
 *
 * Plan 0018: FR-R1 확장 API 추가 (upsertTokens, findBySessionId, deleteBySessionId, deleteByPuuid)
 */
export interface UserTokensRepo {
  /**
   * List active users (needs_reauth = false)
   * Legacy — Plan 0013 cron 워커 호환
   */
  listActive(): Promise<UserTokensRow[]>;

  /**
   * Get tokens for a specific user
   * Legacy — Plan 0013 cron 워커 호환
   */
  get(userId: string): Promise<UserTokensRow | null>;

  /**
   * Mark user as needing re-authentication
   * Legacy — Plan 0013 cron 워커 호환
   */
  markNeedsReauth(userId: string): Promise<void>;

  /**
   * Upsert a user_tokens row (legacy).
   * bytea columns are sent as `\x<hex>` literals (PostgREST write standard).
   * Conflict target: puuid (UNIQUE).
   * Legacy — Plan 0013 cron 워커 호환
   */
  upsert(row: UserTokenInsert): Promise<{ user_id: string }>;

  /**
   * Plan 0018 FR-R1: 세션 vault 기반 upsert
   * 같은 PUUID로 재로그인 시 덮어쓰기 (onConflict: puuid)
   */
  upsertTokens(input: UpsertTokensInput): Promise<{ user_id: string }>;

  /**
   * Plan 0018 FR-R1: session_id로 토큰 조회
   * PGRST116 (not found) → null, 그 외 에러는 throw
   */
  findBySessionId(sessionId: string): Promise<UserTokensRow | null>;

  /**
   * Plan 0018 FR-R1: session_id로 토큰 삭제
   * 멱등성: 없는 session_id도 no-op 성공
   */
  deleteBySessionId(sessionId: string): Promise<void>;

  /**
   * Plan 0018 FR-R1: PUUID로 토큰 전체 삭제
   * 관리/로그아웃 route 용도
   */
  deleteByPuuid(puuid: string): Promise<void>;
}

/**
 * Create Supabase-backed user tokens repository
 * Uses service role key to bypass RLS
 *
 * @param supabase - Supabase client (service role)
 * @returns UserTokensRepo instance
 */
export function createUserTokensRepo(supabase: SupabaseClient): UserTokensRepo {
  return {
    async listActive(): Promise<UserTokensRow[]> {
      const { data, error } = await supabase
        .from("user_tokens")
        .select("*")
        .eq("needs_reauth", false);

      if (error) {
        throw new Error(`Failed to list active users: ${String(error.message)}`);
      }

      const rows = data as Record<string, unknown>[];
      return rows.map(normalizeRow);
    },

    async get(userId: string): Promise<UserTokensRow | null> {
      const result = await supabase
        .from("user_tokens")
        .select("*")
        .eq("user_id", userId)
        .single();

      if (result.error) {
        if (result.error.code === "PGRST116") {
          // Not found
          return null;
        }
        throw new Error(`Failed to get user tokens: ${String(result.error.message)}`);
      }

      if (!result.data) return null;
      return normalizeRow(result.data as Record<string, unknown>);
    },

    async markNeedsReauth(userId: string): Promise<void> {
      const { error } = await supabase
        .from("user_tokens")
        .update({ needs_reauth: true })
        .eq("user_id", userId);

      if (error) {
        throw new Error(`Failed to mark needs_reauth: ${String(error.message)}`);
      }
    },

    async upsert(row: UserTokenInsert): Promise<{ user_id: string }> {
      const payload = serializeInsert(row);
      const { data, error } = await supabase
        .from("user_tokens")
        .upsert(payload, { onConflict: "puuid" })
        .select("user_id")
        .single();

      if (error) {
        throw new Error(`Failed to upsert user tokens: ${String(error.message)}`);
      }
      return { user_id: String(data.user_id) };
    },

    // === Plan 0018 FR-R1: 신규 API ===

    async upsertTokens(input: UpsertTokensInput): Promise<{ user_id: string }> {
      const payload = {
        puuid: input.puuid,
        session_id: input.sessionId,
        session_expires_at: input.sessionExpiresAt.toISOString(),
        ssid_enc: input.ssidEnc,
        tdid_enc: input.tdidEnc,
        access_token_enc: encodeBytea(input.accessTokenEnc),
        refresh_token_enc: encodeBytea(new Uint8Array()), // Placeholder - FR-R1 범위 밖
        entitlements_jwt_enc: encodeBytea(input.entitlementsJwtEnc),
        expires_at: input.accessExpiresAt.toISOString(),
        needs_reauth: false,
      };

      const { data, error } = await supabase
        .from("user_tokens")
        .upsert(payload, { onConflict: "puuid" })
        .select("user_id")
        .single();

      if (error) {
        throw new Error(`Failed to upsert user tokens: ${String(error.message)}`);
      }
      return { user_id: String(data.user_id) };
    },

    async findBySessionId(sessionId: string): Promise<UserTokensRow | null> {
      const result = await supabase
        .from("user_tokens")
        .select("*")
        .eq("session_id", sessionId)
        .single();

      if (result.error) {
        if (result.error.code === "PGRST116") {
          // Not found
          return null;
        }
        throw new Error(`Failed to find user tokens by session_id: ${String(result.error.message)}`);
      }

      if (!result.data) return null;
      return normalizeRow(result.data as Record<string, unknown>);
    },

    async deleteBySessionId(sessionId: string): Promise<void> {
      const { error } = await supabase
        .from("user_tokens")
        .delete()
        .eq("session_id", sessionId);

      // PGRST116는 not found인데, delete는 0 rows도 성공으로 처리
      // error가 있고 code가 PGRST116이 아니면 throw
      if (error && error.code !== "PGRST116") {
        throw new Error(`Failed to delete user tokens by session_id: ${String(error.message)}`);
      }
    },

    async deleteByPuuid(puuid: string): Promise<void> {
      const { error } = await supabase
        .from("user_tokens")
        .delete()
        .eq("puuid", puuid);

      if (error && error.code !== "PGRST116") {
        throw new Error(`Failed to delete user tokens by puuid: ${String(error.message)}`);
      }
    },
  };
}

export { BytEaParseError };
