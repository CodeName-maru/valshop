/**
 * User Tokens Repository
 * Port interface + Supabase adapter for accessing user tokens
 *
 * Plan 0014: PostgREST serializes bytea columns as `\x<hex>` strings on read
 * and accepts the same literal on write. We normalize at this adapter boundary
 * so that domain code (worker / cron / etc.) only ever sees `Uint8Array`.
 */

import type { UserTokensRow, UserTokenInsert } from "./types";
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
 */
export interface UserTokensRepo {
  /**
   * List active users (needs_reauth = false)
   */
  listActive(): Promise<UserTokensRow[]>;

  /**
   * Get tokens for a specific user
   */
  get(userId: string): Promise<UserTokensRow | null>;

  /**
   * Mark user as needing re-authentication
   */
  markNeedsReauth(userId: string): Promise<void>;

  /**
   * Upsert a user_tokens row.
   * bytea columns are sent as `\x<hex>` literals (PostgREST write standard).
   * Conflict target: puuid (UNIQUE).
   */
  upsert(row: UserTokenInsert): Promise<{ user_id: string }>;
}

/**
 * Create Supabase-backed user tokens repository
 * Uses service role key to bypass RLS
 *
 * @param supabase - Supabase client (service role)
 * @returns UserTokensRepo instance
 */
export function createUserTokensRepo(supabase: any): UserTokensRepo {
  return {
    async listActive(): Promise<UserTokensRow[]> {
      const { data, error } = await supabase
        .from("user_tokens")
        .select("*")
        .eq("needs_reauth", false);

      if (error) {
        throw new Error(`Failed to list active users: ${error.message}`);
      }

      const rows = (data || []) as Record<string, unknown>[];
      return rows.map(normalizeRow);
    },

    async get(userId: string): Promise<UserTokensRow | null> {
      const { data, error } = await supabase
        .from("user_tokens")
        .select("*")
        .eq("user_id", userId)
        .single();

      if (error) {
        if (error.code === "PGRST116") {
          // Not found
          return null;
        }
        throw new Error(`Failed to get user tokens: ${error.message}`);
      }

      if (!data) return null;
      return normalizeRow(data as Record<string, unknown>);
    },

    async markNeedsReauth(userId: string): Promise<void> {
      const { error } = await supabase
        .from("user_tokens")
        .update({ needs_reauth: true })
        .eq("user_id", userId);

      if (error) {
        throw new Error(`Failed to mark needs_reauth: ${error.message}`);
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
        throw new Error(`Failed to upsert user tokens: ${error.message}`);
      }
      return { user_id: (data as { user_id: string }).user_id };
    },
  };
}

export { BytEaParseError };
