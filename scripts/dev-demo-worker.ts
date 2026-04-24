/**
 * Dev demo: 워커 happy-path를 로컬 Postgres + mocked Riot/Resend 로 end-to-end 실행.
 * 목적: Riot 인증 없이 DB/매칭/알림-idempotency 를 실제 DB 트랜잭션으로 검증.
 *
 * 실행:
 *   npx tsx scripts/dev-demo-worker.ts
 *
 * 전제:
 *   - `supabase start` 완료
 *   - .env.local 세팅
 *
 * NOTE: lib/supabase/*-repo.ts 를 사용하지 않고 pg 기반으로 재구현한다.
 *   - PostgREST 의 bytea 직렬화(`\x...` hex 문자열) 와 worker 의 `Buffer.from(col).toString("base64")`
 *     사이에 임피던스 미스매치가 있어서 supabase-js 로는 토큰 round-trip 이 깨짐.
 *   - 이 불일치 자체가 Plan 0008 잠재 버그. (후속 이슈로 기록 권장)
 */

import { Client as PgClient } from "pg";
import { loadKeyFromEnv, encrypt } from "@/lib/crypto/aes-gcm";
import type { UserTokensRepo } from "@/lib/supabase/user-tokens-repo";
import type { WishlistRepo } from "@/lib/supabase/wishlist-repo";
import type { NotificationsRepo } from "@/lib/supabase/notifications-repo";
import type { UserTokensRow } from "@/lib/supabase/types";
import { runWorker } from "@/lib/worker/check-wishlist";
import type { StorefrontClient } from "@/lib/riot/storefront-server";
import type { Catalog } from "@/lib/valorant-api/catalog";
import type { ResendLike } from "@/lib/email/dispatch";

// ---- 환경 로드 ----
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
for (const line of readFileSync(resolve(process.cwd(), ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}

const PG_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const SEEDED_SKIN = "11111111-1111-1111-1111-111111111111";
const PUUID = "dev-puuid-0001";

function createPgRepos(pg: PgClient) {
  const userTokensRepo: UserTokensRepo = {
    async listActive() {
      const r = await pg.query<UserTokensRow>(
        "SELECT user_id::text, puuid, access_token_enc, refresh_token_enc, entitlements_jwt_enc, expires_at, created_at, updated_at, needs_reauth FROM user_tokens WHERE needs_reauth = false"
      );
      return r.rows;
    },
    async get(userId) {
      const r = await pg.query<UserTokensRow>(
        "SELECT user_id::text, puuid, access_token_enc, refresh_token_enc, entitlements_jwt_enc, expires_at, created_at, updated_at, needs_reauth FROM user_tokens WHERE user_id = $1",
        [userId]
      );
      return r.rows[0] ?? null;
    },
    async markNeedsReauth(userId) {
      await pg.query("UPDATE user_tokens SET needs_reauth = true WHERE user_id = $1", [userId]);
    },
  };

  const wishlistRepo: WishlistRepo = {
    async listFor(userId) {
      const r = await pg.query<{ skin_uuid: string }>(
        "SELECT skin_uuid FROM wishlist WHERE user_id = $1",
        [userId]
      );
      return r.rows.map((row) => row.skin_uuid);
    },
  };

  const notificationsRepo: NotificationsRepo = {
    async filterUnsent(userId, skinUuids, rotationDate) {
      if (skinUuids.length === 0) return [];
      const r = await pg.query<{ skin_uuid: string }>(
        "SELECT skin_uuid FROM notifications_sent WHERE user_id = $1 AND rotation_date = $2::date AND skin_uuid = ANY($3::text[])",
        [userId, rotationDate.toISOString().slice(0, 10), skinUuids]
      );
      const sent = new Set(r.rows.map((row) => row.skin_uuid));
      return skinUuids.filter((u) => !sent.has(u));
    },
    async insert(userId, skinUuids, rotationDate) {
      if (skinUuids.length === 0) return;
      const values = skinUuids.map((_, i) => `($1, $${i + 3}, $2::date)`).join(", ");
      await pg.query(
        `INSERT INTO notifications_sent (user_id, skin_uuid, rotation_date) VALUES ${values} ON CONFLICT DO NOTHING`,
        [userId, rotationDate.toISOString().slice(0, 10), ...skinUuids]
      );
    },
  };

  return { userTokensRepo, wishlistRepo, notificationsRepo };
}

async function main() {
  const pg = new PgClient({ connectionString: PG_URL });
  await pg.connect();
  const key = await loadKeyFromEnv();

  // 1. 기존 데모 유저 정리
  await pg.query("DELETE FROM user_tokens WHERE puuid = $1", [PUUID]);

  // 2. 더미 토큰 암호화 후 user_tokens 삽입
  //    bytea 에 '암호문의 base64 문자열' 을 UTF-8 바이트로 저장.
  //    worker 의 decryptTokens 는 Buffer.from(col).toString("base64") 하는데 col 이 Buffer 면
  //    원래 base64 문자열의 UTF-8 바이트 → base64 → 원본 base64 (1:1) ... 실제로는 변환이 달라
  //    원본 base64 를 그대로 복원하려면 bytea 에 "base64 문자열의 UTF-8 바이트" 가 아니라
  //    "base64 를 디코딩한 원본 ciphertext 바이트" 를 넣어야 한다.
  const [accessEnc, refreshEnc, entEnc] = await Promise.all([
    encrypt("dummy-access-token", key),
    encrypt("dummy-refresh-token", key),
    encrypt("dummy-entitlements-jwt", key),
  ]);
  const ins = await pg.query<{ user_id: string }>(
    `INSERT INTO user_tokens (puuid, access_token_enc, refresh_token_enc, entitlements_jwt_enc, expires_at, needs_reauth)
     VALUES ($1, $2::bytea, $3::bytea, $4::bytea, $5::timestamptz, false)
     RETURNING user_id`,
    [
      PUUID,
      Buffer.from(accessEnc, "base64"),   // ciphertext 원본 바이트
      Buffer.from(refreshEnc, "base64"),
      Buffer.from(entEnc, "base64"),
      new Date(Date.now() + 3600_000).toISOString(),
    ]
  );
  const userId = ins.rows[0].user_id;
  console.log(`[seed] user_id=${userId}`);

  // 3. wishlist 시드
  await pg.query("DELETE FROM wishlist WHERE user_id = $1", [userId]);
  await pg.query("INSERT INTO wishlist (user_id, skin_uuid) VALUES ($1, $2)", [userId, SEEDED_SKIN]);
  console.log(`[seed] wishlist skin_uuid=${SEEDED_SKIN}`);

  // notifications_sent 초기화
  await pg.query("DELETE FROM notifications_sent WHERE user_id = $1", [userId]);

  // 4. Mock storefront
  const mockStorefront: StorefrontClient = {
    async fetchStore() {
      return {
        skinUuids: [SEEDED_SKIN, "deadbeef-2222-3333-4444-555555555555"],
        endsAtEpoch: Math.floor(Date.now() / 1000) + 3600,
      };
    },
  };

  // 5. Mock catalog → MatchedSkin 모양으로 반환
  const mockCatalog: Catalog = {
    async lookupMany(uuids: string[]) {
      const m = new Map();
      for (const uuid of uuids) {
        m.set(uuid, {
          uuid,
          name: `Demo Skin ${uuid.slice(0, 8)}`,
          priceVp: 1775,
          iconUrl: "https://example.com/icon.png",
        });
      }
      return m;
    },
  } as Catalog;

  // 6. Mock resend
  const sent: Array<{ to: string; subject: string }> = [];
  const mockResend: ResendLike = {
    emails: {
      async send(payload: any) {
        sent.push({ to: payload.to, subject: payload.subject });
        console.log(`[resend.mock] → ${payload.to} / ${payload.subject}`);
        return { data: { id: `mock-${Date.now()}` }, error: null } as any;
      },
    },
  } as ResendLike;

  const repos = createPgRepos(pg);
  const deps = {
    ...repos,
    storefrontClient: mockStorefront,
    catalog: mockCatalog,
    resend: mockResend,
  };

  console.log("\n--- 1st run (expect: 1 notified) ---");
  const r1 = await runWorker(deps);
  console.log("result:", r1);

  console.log("\n--- 2nd run (expect: idempotent, 0 notified) ---");
  const r2 = await runWorker(deps);
  console.log("result:", r2);

  const { rows } = await pg.query(
    "SELECT skin_uuid, rotation_date FROM notifications_sent WHERE user_id = $1",
    [userId]
  );
  console.log("\nnotifications_sent rows:", rows);
  console.log("resend calls:", sent.length);

  await pg.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
