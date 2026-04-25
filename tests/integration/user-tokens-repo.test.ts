/**
 * Plan 0014 Phase 4: Real round-trip integration tests against local Supabase.
 *
 * 실행:
 *   supabase start
 *   SUPABASE_INTEGRATION=1 npm run test:integration
 *
 * 환경변수 (`.env.local` 권장):
 *   - NEXT_PUBLIC_SUPABASE_URL
 *   - SUPABASE_SERVICE_ROLE_KEY
 *   - TOKEN_ENC_KEY (32-byte base64)
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { encrypt, loadKeyFromEnv, decryptTokens } from "@/lib/crypto/aes-gcm";
import { createUserTokensRepo } from "@/lib/supabase/user-tokens-repo";
import { createWishlistRepo } from "@/lib/supabase/wishlist-repo";
import { createNotificationsRepo } from "@/lib/supabase/notifications-repo";
import { runWorker } from "@/lib/worker/check-wishlist";
import type { StorefrontClient } from "@/lib/riot/storefront-server";
import type { Catalog } from "@/lib/valorant-api/catalog";
import type { ResendLike } from "@/lib/email/dispatch";

const ENABLED = process.env.SUPABASE_INTEGRATION === "1";
const PUUID_PREFIX = "plan0014-test-";
const SEEDED_SKIN = "11111111-1111-1111-1111-111111111111";

// Load .env.local manually so npm test can pick up keys without dotenv plugin.
function loadEnv() {
  try {
    const fs = require("node:fs");
    const path = require("node:path");
    const text = fs.readFileSync(path.resolve(process.cwd(), ".env.local"), "utf8");
    for (const line of text.split("\n")) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch {
    /* no .env.local — env must be supplied externally */
  }
}

describe.runIf(ENABLED)("[integration] user-tokens-repo round-trip", () => {
  let supabase: ReturnType<typeof createClient>;
  let key: CryptoKey;
  let userTokensRepo: ReturnType<typeof createUserTokensRepo>;
  let wishlistRepo: ReturnType<typeof createWishlistRepo>;
  let notificationsRepo: ReturnType<typeof createNotificationsRepo>;

  async function cleanup() {
    // Delete by puuid prefix; cascade handles wishlist/notifications via user_id FK.
    const { data: rows } = await supabase
      .from("user_tokens")
      .select("user_id")
      .like("puuid", `${PUUID_PREFIX}%`);
    const ids = (rows || []).map((r: any) => r.user_id);
    if (ids.length > 0) {
      await supabase.from("notifications_sent").delete().in("user_id", ids);
      await supabase.from("wishlist").delete().in("user_id", ids);
    }
    await supabase.from("user_tokens").delete().like("puuid", `${PUUID_PREFIX}%`);
  }

  async function seedUser(opts: { puuid: string; plaintexts: { access: string; refresh: string; ent: string } }) {
    const [a, r, e] = await Promise.all([
      encrypt(opts.plaintexts.access, key),
      encrypt(opts.plaintexts.refresh, key),
      encrypt(opts.plaintexts.ent, key),
    ]);
    const { user_id } = await userTokensRepo.upsert({
      puuid: opts.puuid,
      access_token_enc: new Uint8Array(Buffer.from(a, "base64")),
      refresh_token_enc: new Uint8Array(Buffer.from(r, "base64")),
      entitlements_jwt_enc: new Uint8Array(Buffer.from(e, "base64")),
      expires_at: new Date(Date.now() + 3600_000),
      needs_reauth: false,
    });
    return user_id;
  }

  beforeAll(async () => {
    loadEnv();
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const srk = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !srk) throw new Error("Missing Supabase env vars");
    supabase = createClient(url, srk, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    key = await loadKeyFromEnv();
    userTokensRepo = createUserTokensRepo(supabase);
    wishlistRepo = createWishlistRepo(supabase);
    notificationsRepo = createNotificationsRepo(supabase);
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
  });

  it("Test 4-1: AES ciphertext round-trip via get() decrypts to original plaintexts", async () => {
    const userId = await seedUser({
      puuid: `${PUUID_PREFIX}rt-1`,
      plaintexts: { access: "access-XYZ", refresh: "refresh-XYZ", ent: "ent-XYZ" },
    });
    const row = await userTokensRepo.get(userId);
    if (row === null) throw new Error("expected row to be non-null");
    expect(row.access_token_enc).toBeInstanceOf(Uint8Array);
    const decrypted = await decryptTokens(
      Buffer.from(row.access_token_enc).toString("base64"),
      Buffer.from(row.refresh_token_enc).toString("base64"),
      Buffer.from(row.entitlements_jwt_enc).toString("base64"),
      key
    );
    expect(decrypted.accessToken).toBe("access-XYZ");
    expect(decrypted.refreshToken).toBe("refresh-XYZ");
    expect(decrypted.entitlementsJwt).toBe("ent-XYZ");
  });

  it("Test 4-2: listActive round-trip (2 users)", async () => {
    await seedUser({
      puuid: `${PUUID_PREFIX}rt-list-A`,
      plaintexts: { access: "A-acc", refresh: "A-ref", ent: "A-ent" },
    });
    await seedUser({
      puuid: `${PUUID_PREFIX}rt-list-B`,
      plaintexts: { access: "B-acc", refresh: "B-ref", ent: "B-ent" },
    });
    const rows = await userTokensRepo.listActive();
    const ours = rows.filter((r) => r.puuid.startsWith(PUUID_PREFIX));
    expect(ours.length).toBeGreaterThanOrEqual(2);
    for (const row of ours) {
      const dec = await decryptTokens(
        Buffer.from(row.access_token_enc).toString("base64"),
        Buffer.from(row.refresh_token_enc).toString("base64"),
        Buffer.from(row.entitlements_jwt_enc).toString("base64"),
        key
      );
      // plaintexts encode the puuid suffix (A-/B-) — verify mapping is intact.
      const suffix = row.puuid.endsWith("rt-list-A") ? "A" : row.puuid.endsWith("rt-list-B") ? "B" : null;
      if (suffix) {
        expect(dec.accessToken).toBe(`${suffix}-acc`);
      }
    }
  });

  it("Test 4-3: needs_reauth filter — marked user excluded from listActive", async () => {
    const idA = await seedUser({
      puuid: `${PUUID_PREFIX}reauth-A`,
      plaintexts: { access: "a", refresh: "r", ent: "e" },
    });
    const idB = await seedUser({
      puuid: `${PUUID_PREFIX}reauth-B`,
      plaintexts: { access: "a", refresh: "r", ent: "e" },
    });
    await userTokensRepo.markNeedsReauth(idB);
    const rows = await userTokensRepo.listActive();
    const ids = rows.map((r) => r.user_id);
    expect(ids).toContain(idA);
    expect(ids).not.toContain(idB);
  });

  it("Test 4-4: runWorker happy-path against real DB notifies exactly 1", async () => {
    await cleanup();
    const userId = await seedUser({
      puuid: `${PUUID_PREFIX}worker-1`,
      plaintexts: { access: "acc", refresh: "ref", ent: "ent" },
    });
    await supabase.from("wishlist").insert({ user_id: userId, skin_uuid: SEEDED_SKIN });

    const storefront: StorefrontClient = {
      async fetchStore() {
        return { skinUuids: [SEEDED_SKIN], endsAtEpoch: Math.floor(Date.now() / 1000) + 3600 };
      },
    };
    const catalog: Catalog = {
      async lookupMany(uuids: string[]) {
        const m = new Map();
        for (const u of uuids) {
          m.set(u, { uuid: u, name: "Demo", priceVp: 1775, iconUrl: "https://example.com/i.png" });
        }
        return m;
      },
    } as Catalog;
    const sent: any[] = [];
    const resend: ResendLike = {
      emails: {
        async send(p: any) {
          sent.push(p);
          return { id: `mock-${Date.now()}` };
        },
      },
    };

    const result = await runWorker({
      userTokensRepo,
      wishlistRepo,
      notificationsRepo,
      storefrontClient: storefront,
      catalog,
      resend,
    });
    expect(result.notified).toBe(1);
    expect(result.errors).toBe(0);
    expect(sent).toHaveLength(1);
  });

  it("Test 4-5: runWorker is idempotent on re-run (notified=0 second time)", async () => {
    // Re-uses the state from 4-4: wishlist + notifications_sent already present.
    const storefront: StorefrontClient = {
      async fetchStore() {
        return { skinUuids: [SEEDED_SKIN], endsAtEpoch: Math.floor(Date.now() / 1000) + 3600 };
      },
    };
    const catalog: Catalog = {
      async lookupMany(uuids: string[]) {
        const m = new Map();
        for (const u of uuids) {
          m.set(u, { uuid: u, name: "Demo", priceVp: 1775, iconUrl: "https://example.com/i.png" });
        }
        return m;
      },
    } as Catalog;
    const sent: any[] = [];
    const resend: ResendLike = {
      emails: {
        async send(p: any) {
          sent.push(p);
          return { id: `mock-${Date.now()}` };
        },
      },
    };
    const result = await runWorker({
      userTokensRepo,
      wishlistRepo,
      notificationsRepo,
      storefrontClient: storefront,
      catalog,
      resend,
    });
    expect(result.notified).toBe(0);
    expect(sent).toHaveLength(0);
  });
});

// When the gate is off, surface a single skipped marker so CI/devs see why.
describe.skipIf(ENABLED)("[integration] user-tokens-repo round-trip (gated)", () => {
  it("skipped — set SUPABASE_INTEGRATION=1 to enable", () => {
    expect(true).toBe(true);
  });
});
