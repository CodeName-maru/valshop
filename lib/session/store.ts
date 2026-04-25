/**
 * Plan 0020 Phase 2: lib/session/store.ts
 *
 * 세션 라이프사이클(store) + ssid 재인증(reauth)
 * spec § 4-3 재방문 flow 5분기 구현
 */

import { createServiceRoleClient } from "@/lib/supabase/admin";
import { createUserTokensRepo } from "@/lib/supabase/user-tokens-repo";
import type { UserTokensRow } from "@/lib/supabase/types";
import type { SessionTokens, ResolvedSession } from "./types";
import { reauthAccess } from "./reauth";
import { encryptWithKey, getTokenKey, decryptWithKey, NEAR_EXPIRY_THRESHOLD_SEC, SESSION_TTL_SEC } from "./crypto";
import { httpRiotFetcher } from "@/lib/riot/fetcher";
import { logger as realLogger } from "@/lib/logger";

// Re-export with our module prefix
const logger = {
  info: (msg: string, meta?: Record<string, unknown>) => realLogger.info(`[session] ${msg}`, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => realLogger.warn(`[session] ${msg}`, meta),
  error: (msg: string, meta?: Record<string, unknown>) => realLogger.error(`[session] ${msg}`, meta),
};

/**
 * Plan 0020: Session store
 *
 * @internal
 */
export interface SessionStore {
  createSession(puuid: string, tokens: SessionTokens): Promise<{ sessionId: string; maxAge: number }>;
  resolve(sessionId: string): Promise<ResolvedSession | null>;
  destroy(sessionId: string): Promise<void>;
}

/**
 * Plan 0020: Session ID 접두사 (로그용)
 */
function prefixSessionId(sessionId: string): string {
  return sessionId.slice(0, 8);
}

/**
 * Plan 0020: PUUID 접두사 (로그용)
 */
function prefixPuuid(puuid: string): string {
  return puuid.slice(0, 8);
}

/**
 * Plan 0020: 암호화된 DecryptedRow
 */
type DecryptedRow = {
  puuid: string;
  ssid: string;
  tdid: string | null;
  accessToken: string;
  entitlementsJwt: string;
  region: string;
  accessExpiresAt: number;
  sessionExpiresAt: number;
};

/**
 * Plan 0020: Row 복호화 (TOKEN_ENC_KEY)
 *
 * 하나라도 복호화 실패 시 row 삭제 + null 반환
 */
async function decryptRow(row: UserTokensRow): Promise<DecryptedRow | null> {
  const key = await getTokenKey();

  // ssid_enc 복호화
  const ssid = await decryptWithKey(row.ssid_enc, key);
  if (ssid === null) {
    logger.warn("[decryptRow] ssid_enc 복호화 실패, row 삭제", { sessionId: row.session_id });
    return null;
  }

  // tdid_enc 복호화 (nullable)
  let tdid: string | null = null;
  if (row.tdid_enc) {
    const decrypted = await decryptWithKey(row.tdid_enc, key);
    if (decrypted === null) {
      logger.warn("[decryptRow] tdid_enc 복호화 실패, row 삭제", { sessionId: row.session_id });
      return null;
    }
    tdid = decrypted;
  }

  // access_token_enc 복호화
  const accessToken = await decryptWithKey(Buffer.from(row.access_token_enc).toString("base64"), key);
  if (accessToken === null) {
    logger.warn("[decryptRow] access_token_enc 복호화 실패, row 삭제", { sessionId: row.session_id });
    return null;
  }

  // entitlements_jwt_enc 복호화
  const entitlementsJwt = await decryptWithKey(Buffer.from(row.entitlements_jwt_enc).toString("base64"), key);
  if (entitlementsJwt === null) {
    logger.warn("[decryptRow] entitlements_jwt_enc 복호화 실패, row 삭제", { sessionId: row.session_id });
    return null;
  }

  // session_expires_at 변환
  const sessionExpiresAt = Math.floor(row.session_expires_at.getTime() / 1000);

  // access_expires_at 변환 (실제 DB 컬럼명은 expires_at)
  const accessExpiresAt = Math.floor(row.expires_at.getTime() / 1000);

  return {
    puuid: row.puuid,
    ssid,
    tdid,
    accessToken,
    entitlementsJwt,
    region: row.region,
    accessExpiresAt,
    sessionExpiresAt,
  };
}

/**
 * Plan 0020: SessionStore 구현
 */
export function createSessionStore(): SessionStore {
  const client = createServiceRoleClient();
  const repo = createUserTokensRepo(client);

  return {
    /**
     * Plan 0020: createSession
     *
     * crypto.randomUUID()로 session_id 발급
     * 14일 TTL 설정
     */
    async createSession(puuid: string, tokens: SessionTokens): Promise<{ sessionId: string; maxAge: number }> {
      const sessionId = crypto.randomUUID();
      const key = await getTokenKey();

      // 암호화
      const [ssidEnc, tdidEnc, accessTokenEnc, entitlementsJwtEnc] = await Promise.all([
        encryptWithKey(tokens.ssid, key),
        tokens.tdid ? encryptWithKey(tokens.tdid, key) : Promise.resolve(null),
        encryptWithKey(tokens.accessToken, key),
        encryptWithKey(tokens.entitlementsJwt, key),
      ]);

      // session_expires_at = now + 14일
      const sessionExpiresAt = new Date(Date.now() + SESSION_TTL_SEC * 1000);

      // access_expires_at = now + accessExpiresIn
      const accessExpiresAt = new Date(Date.now() + tokens.accessExpiresIn * 1000);

      // DB upsert
      await repo.upsertTokens({
        puuid,
        sessionId,
        sessionExpiresAt,
        ssidEnc,
        tdidEnc,
        accessTokenEnc: Buffer.from(accessTokenEnc, "base64"),
        entitlementsJwtEnc: Buffer.from(entitlementsJwtEnc, "base64"),
        accessExpiresAt,
      });

      logger.info("[createSession] 세션 생성", {
        sessionId: prefixSessionId(sessionId),
        puuid: prefixPuuid(puuid),
      });

      return {
        sessionId,
        maxAge: SESSION_TTL_SEC,
      };
    },

    /**
     * Plan 0020: resolve - 5분기 로직
     *
     * 1) row miss → null
     * 2) session_expires_at ≤ now → delete + null
     * 3) access_expires_at > now+60s → fresh (DB read-only)
     * 4) reauthWithSsid 성공 → UPDATE + 반환
     * 5) reauth 실패 → auth_failure: delete + null / upstream: 처리 분기
     */
    async resolve(sessionId: string): Promise<ResolvedSession | null> {
      const nowSec = Math.floor(Date.now() / 1000);
      const nearExpiryThreshold = nowSec + NEAR_EXPIRY_THRESHOLD_SEC;

      // 1) row 조회
      const row = await repo.findBySessionId(sessionId);
      if (!row) {
        logger.info("[resolve] row miss", { sessionId: prefixSessionId(sessionId) });
        return null;
      }

      // 2) 복호화
      const decrypted = await decryptRow(row);
      if (decrypted === null) {
        // 복호화 실패 시 row 삭제
        await repo.deleteBySessionId(sessionId);
        return null;
      }

      // 3) session 만료 검증
      if (decrypted.sessionExpiresAt <= nowSec) {
        logger.info("[resolve] session 만료, row 삭제", {
          sessionId: prefixSessionId(sessionId),
        });
        await repo.deleteBySessionId(sessionId);
        return null;
      }

      // 4) access token fresh 검증 (60s 여유)
      if (decrypted.accessExpiresAt > nearExpiryThreshold) {
        logger.info("[resolve] fresh path", {
          sessionId: prefixSessionId(sessionId),
          puuid: prefixPuuid(decrypted.puuid),
        });
        return {
          puuid: decrypted.puuid,
          accessToken: decrypted.accessToken,
          entitlementsJwt: decrypted.entitlementsJwt,
          region: decrypted.region,
          accessExpiresAt: decrypted.accessExpiresAt,
        };
      }

      // 5) near-expiry: reauth 필요
      logger.info("[resolve] near-expiry, reauth 시도", {
        sessionId: prefixSessionId(sessionId),
        puuid: prefixPuuid(decrypted.puuid),
      });

      const reauthResult = await reauthAccess(
        decrypted.ssid,
        decrypted.tdid,
        httpRiotFetcher
      );

      if (reauthResult.kind === "expired") {
        // auth_failure: row 삭제 + null
        logger.warn("[resolve] reauth expired (auth_failure), row 삭제", {
          sessionId: prefixSessionId(sessionId),
        });
        await repo.deleteBySessionId(sessionId);
        return null;
      }

      if (reauthResult.kind === "upstream") {
        // upstream + access still valid → optimistic 반환
        if (decrypted.accessExpiresAt > nowSec) {
          logger.warn("[resolve] reauth upstream but access 유효, optimistic 반환", {
            sessionId: prefixSessionId(sessionId),
          });
          return {
            puuid: decrypted.puuid,
            accessToken: decrypted.accessToken,
            entitlementsJwt: decrypted.entitlementsJwt,
            region: decrypted.region,
            accessExpiresAt: decrypted.accessExpiresAt,
          };
        }

        // upstream + access 만료 → null (row 유지 - 일시장애 가정)
        logger.warn("[resolve] reauth upstream + access 만료, null 반환 (row 유지)", {
          sessionId: prefixSessionId(sessionId),
        });
        return null;
      }

      // reauth.ok: DB 업데이트
      const newKey = await getTokenKey();
      const [newSsidEnc, newAccessTokenEnc, newEntitlementsJwtEnc] = await Promise.all([
        encryptWithKey(decrypted.ssid, newKey), // ssid 재사용 (필요 시 rotate)
        encryptWithKey(reauthResult.accessToken, newKey),
        encryptWithKey(reauthResult.entitlementsJwt, newKey),
      ]);

      await repo.upsertTokens({
        puuid: decrypted.puuid,
        sessionId,
        sessionExpiresAt: new Date(decrypted.sessionExpiresAt * 1000),
        ssidEnc: newSsidEnc,
        tdidEnc: decrypted.tdid ? await encryptWithKey(decrypted.tdid, newKey) : null,
        accessTokenEnc: Buffer.from(newAccessTokenEnc, "base64"),
        entitlementsJwtEnc: Buffer.from(newEntitlementsJwtEnc, "base64"),
        accessExpiresAt: new Date(reauthResult.accessExpiresAt * 1000),
      });

      logger.info("[resolve] reauth 성공, DB 업데이트", {
        sessionId: prefixSessionId(sessionId),
        puuid: prefixPuuid(decrypted.puuid),
      });

      return {
        puuid: decrypted.puuid,
        accessToken: reauthResult.accessToken,
        entitlementsJwt: reauthResult.entitlementsJwt,
        region: decrypted.region,
        accessExpiresAt: reauthResult.accessExpiresAt,
      };
    },

    /**
     * Plan 0020: destroy
     *
     * idempotent: 없는 session_id도 no-op 성공
     */
    async destroy(sessionId: string): Promise<void> {
      await repo.deleteBySessionId(sessionId);
      logger.info("[destroy] 세션 삭제", { sessionId: prefixSessionId(sessionId) });
    },
  };
}

// Default instance
let defaultStore: SessionStore | null = null;

export function getSessionStore(): SessionStore {
  if (defaultStore) return defaultStore;
  defaultStore = createSessionStore();
  return defaultStore;
}
