/**
 * Dev demo: 워커 happy-path를 로컬 Supabase + mocked Riot/Resend 로 end-to-end 실행.
 * 목적: Riot 인증 없이 DB/매칭/알림-idempotency 를 실제 DB 트랜잭션으로 검증.
 *
 * 실행:
 *   npx tsx scripts/dev-demo-worker.ts
 *
 * 전제:
 *   - `supabase start` 완료
 *   - .env.local 세팅 (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TOKEN_ENC_KEY)
 *
 * NOTE: Plan 0014 fix 이후 표준 supabase-js + repo (`createUserTokensRepo` 등) 를 그대로 사용.
 *   - 이전 버전은 PostgREST 의 bytea 직렬화(`\x` hex string) 와 worker 의
 *     `Buffer.from(col).toString("base64")` 사이 임피던스 미스매치 때문에 pg 기반으로
 *     우회했으나, 본 fix 로 repo 어댑터에서 정규화/직렬화를 단일화하여 우회가 사라졌다.
 */

import { createClient } from "@supabase/supabase-js";
import { loadKeyFromEnv, encrypt } from "@/lib/crypto/aes-gcm";
import { createUserTokensRepo } from "@/lib/supabase/user-tokens-repo";
import { createWishlistRepo } from "@/lib/supabase/wishlist-repo";
import { createNotificationsRepo } from "@/lib/supabase/notifications-repo";
import { runWorker } from "@/lib/worker/check-wishlist";
import type { StorefrontClient } from "@/lib/riot/storefront-server";
import type { Catalog } from "@/lib/valorant-api/catalog";
import type { ResendLike } from "@/lib/email/dispatch";

// ---- 환경 로드 ----
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
for (const line of readFileSync(resolve(process.cwd(), ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && m[1]) process.env[m[1]] = m[2] ?? "";
}

const SEEDED_SKIN = "11111111-1111-1111-1111-111111111111";
const PUUID = "dev-puuid-0001";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 .env.local 에 필요합니다."
    );
  }

  const supabase = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const userTokensRepo = createUserTokensRepo(supabase);
  const wishlistRepo = createWishlistRepo(supabase);
  const notificationsRepo = createNotificationsRepo(supabase);

  const key = await loadKeyFromEnv();

  // 1. 기존 데모 유저 정리 (puuid 기준 — service role 로 직접 삭제)
  await supabase.from("user_tokens").delete().eq("puuid", PUUID);

  // 2. 더미 토큰 암호화 후 user_tokens 업서트 (repo 가 \x hex 직렬화)
  const [accessEnc, refreshEnc, entEnc] = await Promise.all([
    encrypt("dummy-access-token", key),
    encrypt("dummy-refresh-token", key),
    encrypt("dummy-entitlements-jwt", key),
  ]);
  const { user_id: userId } = await userTokensRepo.upsert({
    puuid: PUUID,
    access_token_enc: new Uint8Array(Buffer.from(accessEnc, "base64")),
    refresh_token_enc: new Uint8Array(Buffer.from(refreshEnc, "base64")),
    entitlements_jwt_enc: new Uint8Array(Buffer.from(entEnc, "base64")),
    expires_at: new Date(Date.now() + 3600_000),
    needs_reauth: false,
  });
  console.log(`[seed] user_id=${userId}`);

  // 3. wishlist 시드
  await supabase.from("wishlist").delete().eq("user_id", userId);
  const { error: wlErr } = await supabase
    .from("wishlist")
    .insert({ user_id: userId, skin_uuid: SEEDED_SKIN });
  if (wlErr) throw new Error(`wishlist seed failed: ${wlErr.message}`);
  console.log(`[seed] wishlist skin_uuid=${SEEDED_SKIN}`);

  // notifications_sent 초기화
  await supabase.from("notifications_sent").delete().eq("user_id", userId);

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
  };

  const deps = {
    userTokensRepo,
    wishlistRepo,
    notificationsRepo,
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

  const { data: rows } = await supabase
    .from("notifications_sent")
    .select("skin_uuid, rotation_date")
    .eq("user_id", userId);
  console.log("\nnotifications_sent rows:", rows);
  console.log("resend calls:", sent.length);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
