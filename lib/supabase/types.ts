/**
 * Supabase Database Types
 * Generated from migration files
 */

/**
 * Row type for user_tokens table
 *
 * Plan 0018: FR-R1 세션 vault 컬럼 추가
 */
export interface UserTokensRow {
  user_id: string;
  puuid: string;
  session_id: string;              // UUIDv4, unique, NOT NULL
  session_expires_at: Date;        // vault row 자체의 만료 (서버 세션 길이)
  ssid_enc: string;                // AES-GCM base64 — NOT NULL
  tdid_enc: string | null;         // AES-GCM base64 (nullable: trusted-device 미등록 가능)
  access_token_enc: Uint8Array;
  refresh_token_enc: Uint8Array;
  entitlements_jwt_enc: Uint8Array;
  expires_at: Date;
  created_at: Date;
  updated_at: Date;
  needs_reauth: boolean;
}

/**
 * Insert payload for user_tokens table.
 *
 * Plan 0014: bytea 컬럼은 도메인 레이어에서 raw `Uint8Array` 로 다루고,
 * repo 가 PostgREST 전송 직전에 `\x<hex>` literal 로 직렬화한다.
 *
 * Plan 0018: legacy 호환용. Plan 0013 cron 워커가 사용 중.
 */
export interface UserTokenInsert {
  puuid: string;
  access_token_enc: Uint8Array;
  refresh_token_enc: Uint8Array;
  entitlements_jwt_enc: Uint8Array;
  expires_at: Date | string;
  needs_reauth?: boolean;
}

/**
 * Upsert payload for user_tokens table (Plan 0018 FR-R1).
 *
 * 세션 vault 컬럼 포함. 같은 PUUID로 재로그인 시 덮어쓰기 (onConflict: puuid).
 */
export interface UpsertTokensInput {
  puuid: string;
  sessionId: string;
  sessionExpiresAt: Date;
  ssidEnc: string;
  tdidEnc: string | null;
  accessTokenEnc: Uint8Array;
  entitlementsJwtEnc: Uint8Array;
  accessExpiresAt: Date;
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
