/**
 * Supabase Database Types
 * Generated from migration files
 */

/**
 * Row type for user_tokens table
 */
export interface UserTokensRow {
  user_id: string;
  puuid: string;
  access_token_enc: Uint8Array;
  refresh_token_enc: Uint8Array;
  entitlements_jwt_enc: Uint8Array;
  expires_at: Date;
  created_at: Date;
  updated_at: Date;
  needs_reauth: boolean;
}

/**
 * Row type for wishlist table
 */
export interface WishlistRow {
  user_id: string;
  skin_uuid: string;
  created_at: Date;
}

/**
 * Row type for notifications_sent table
 */
export interface NotificationsSentRow {
  user_id: string;
  skin_uuid: string;
  rotation_date: Date;
  sent_at: Date;
}

/**
 * Auth.users table (partial, email only needed)
 */
export interface AuthUserRow {
  id: string;
  email: string;
}
