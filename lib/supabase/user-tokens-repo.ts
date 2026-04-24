/**
 * User Tokens Repository
 * Port interface + Supabase adapter for accessing user tokens
 */

import type { UserTokensRow } from "./types";

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

      return data || [];
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

      return data;
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
  };
}
