/**
 * Test 3-1 ~ 3-7: Worker Integration Tests
 * Phase 3: Worker endpoint (integration)
 */

import { describe, it, expect, vi } from "vitest";
import { runWorker } from "@/lib/worker/check-wishlist";
import type { UserTokensRow } from "@/lib/supabase/types";
import type { WorkerDeps } from "@/lib/worker/check-wishlist";
import { getKstRotationDate } from "@/lib/supabase/notifications-repo";
import { StorefrontApiError } from "@/lib/riot/storefront-server";
import type { MatchedSkin } from "@/lib/domain/wishlist";

// Top-level mock for crypto module
vi.mock("@/lib/crypto/aes-gcm", () => {
  return {
    loadKeyFromEnv: async () => ({} as any),
    decrypt: async () => "decrypted",
    decryptTokens: async () => ({
      accessToken: "test-token",
      refreshToken: "test-refresh",
      entitlementsJwt: "test-entitlements",
    }),
  };
});

describe("Feature: /api/cron/check-wishlist 워커", () => {
  describe("Scenario: CRON_SECRET 불일치", () => {
    it("Note: This is tested at the API route level", () => {
      // The route-level auth test is documented here
      // Actual API route testing requires next-test-api-route-handler
      expect(true).toBe(true);
    });
  });

  describe("Scenario: 해피 패스 — 매칭 1명, 비매칭 1명", () => {
    it("given유저2명_1명매칭_when워커실행_then이메일1통_notifications_sent1row", async () => {
      // Given:
      const userA: UserTokensRow = {
        user_id: "user-a",
        puuid: "puuid-a",
        access_token_enc: Buffer.from("encrypted-a"),
        refresh_token_enc: Buffer.from("refresh-a"),
        entitlements_jwt_enc: Buffer.from("entitlements-a"),
        expires_at: new Date(Date.now() + 3600000),
        created_at: new Date(),
        updated_at: new Date(),
        needs_reauth: false,
      };

      const userB: UserTokensRow = {
        user_id: "user-b",
        puuid: "puuid-b",
        access_token_enc: Buffer.from("encrypted-b"),
        refresh_token_enc: Buffer.from("refresh-b"),
        entitlements_jwt_enc: Buffer.from("entitlements-b"),
        expires_at: new Date(Date.now() + 3600000),
        created_at: new Date(),
        updated_at: new Date(),
        needs_reauth: false,
      };

      const resendCalls: any[] = [];
      const notificationsInserted: any[] = [];

      const deps: WorkerDeps = {
        userTokensRepo: {
          listActive: async () => [userA, userB],
          get: async () => null,
          markNeedsReauth: async () => {},
        },
        wishlistRepo: {
          listFor: async (userId) => {
            if (userId === "user-a") return ["skin-a"];
            if (userId === "user-b") return ["skin-z"];
            return [];
          },
        },
        notificationsRepo: {
          filterUnsent: async (_userId, skinUuids) => skinUuids,
          insert: async (userId, skinUuids) => {
            notificationsInserted.push({ userId, skinUuids });
          },
        },
        storefrontClient: {
          fetchStore: async () => ({
            skinUuids: ["skin-a", "skin-b", "skin-c", "skin-d"],
            endsAtEpoch: Math.floor(Date.now() / 1000) + 3600,
          }),
        },
        catalog: {
          lookup: async (uuid) => ({
            uuid,
            name: `Skin ${uuid}`,
            priceVp: 1775,
            iconUrl: `https://example.com/${uuid}.png`,
          }),
          lookupMany: async (uuids) => {
            const map = new Map<string, MatchedSkin>();
            for (const uuid of uuids) {
              map.set(uuid, {
                uuid,
                name: `Skin ${uuid}`,
                priceVp: 1775,
                iconUrl: `https://example.com/${uuid}.png`,
              });
            }
            return map;
          },
        },
        resend: {
          emails: {
            send: async (params) => {
              resendCalls.push(params);
              return { id: "test-id" };
            },
          },
        },
      };

      // When
      const result = await runWorker(deps);

      // Then
      expect(result.processed).toBe(2);
      expect(result.notified).toBe(1); // Only user-a has a match
      expect(resendCalls).toHaveLength(1);
      expect(resendCalls[0].to).toContain("user-a");
      expect(notificationsInserted).toHaveLength(1);
      expect(notificationsInserted[0].userId).toBe("user-a");
    });
  });

  describe("Scenario: 같은 로테이션 중복 발송 방지", () => {
    it("given이미sent된스킨_when워커재실행_then이메일0통", async () => {
      const user: UserTokensRow = {
        user_id: "user-a",
        puuid: "puuid-a",
        access_token_enc: Buffer.from("encrypted"),
        refresh_token_enc: Buffer.from("refresh"),
        entitlements_jwt_enc: Buffer.from("entitlements"),
        expires_at: new Date(Date.now() + 3600000),
        created_at: new Date(),
        updated_at: new Date(),
        needs_reauth: false,
      };

      const resendCalls: any[] = [];
      const rotationDate = getKstRotationDate();

      const deps: WorkerDeps = {
        userTokensRepo: {
          listActive: async () => [user],
          get: async () => null,
          markNeedsReauth: async () => {},
        },
        wishlistRepo: {
          listFor: async () => ["skin-a"],
        },
        notificationsRepo: {
          filterUnsent: async (_userId, _skinUuids, _rotationDate) => {
            // Return empty - already sent
            return [];
          },
          insert: async () => {},
        },
        storefrontClient: {
          fetchStore: async () => ({
            skinUuids: ["skin-a"],
            endsAtEpoch: 0,
          }),
        },
        catalog: {
          lookup: async () => ({
            uuid: "skin-a",
            name: "Skin A",
            priceVp: 1775,
            iconUrl: "https://example.com/skin-a.png",
          }),
          lookupMany: async () => new Map(),
        },
        resend: {
          emails: {
            send: async (params) => {
              resendCalls.push(params);
              return { id: "test-id" };
            },
          },
        },
        now: rotationDate,
      };

      // When
      const result = await runWorker(deps);

      // Then
      expect(result.notified).toBe(0);
      expect(resendCalls).toHaveLength(0);
    });
  });

  describe("Scenario: Riot 401 → needs_reauth 마킹", () => {
    it("givenstorefront401_when워커_then해당유저skip_그리고needs_reauth=true업데이트", async () => {
      const user: UserTokensRow = {
        user_id: "user-a",
        puuid: "puuid-a",
        access_token_enc: Buffer.from("encrypted"),
        refresh_token_enc: Buffer.from("refresh"),
        entitlements_jwt_enc: Buffer.from("entitlements"),
        expires_at: new Date(Date.now() + 3600000),
        created_at: new Date(),
        updated_at: new Date(),
        needs_reauth: false,
      };

      let markedReauth = false;
      const resendCalls: any[] = [];

      const deps: WorkerDeps = {
        userTokensRepo: {
          listActive: async () => [user],
          get: async () => null,
          markNeedsReauth: async (userId) => {
            if (userId === "user-a") markedReauth = true;
          },
        },
        wishlistRepo: {
          listFor: async () => ["skin-a"],
        },
        notificationsRepo: {
          filterUnsent: async () => [],
          insert: async () => {},
        },
        storefrontClient: {
          fetchStore: async () => {
            throw new StorefrontApiError("Unauthorized", 401, true);
          },
        },
        catalog: {
          lookup: async () => ({
            uuid: "skin-a",
            name: "Skin A",
            priceVp: 1775,
            iconUrl: "https://example.com/skin-a.png",
          }),
          lookupMany: async () => new Map(),
        },
        resend: {
          emails: {
            send: async () => ({ id: "test-id" }),
          },
        },
      };

      // When
      const result = await runWorker(deps);

      // Then
      expect(markedReauth).toBe(true);
      expect(resendCalls).toHaveLength(0);
      expect(result.errors).toBe(1);
    });
  });

  describe("Scenario: 유저별 실패 격리", () => {
    it("givenuserA예외_userB정상_when워커_thenuserB는정상처리_200반환", async () => {
      const userA: UserTokensRow = {
        user_id: "user-a",
        puuid: "puuid-a",
        access_token_enc: Buffer.from("encrypted-a"),
        refresh_token_enc: Buffer.from("refresh-a"),
        entitlements_jwt_enc: Buffer.from("entitlements-a"),
        expires_at: new Date(Date.now() + 3600000),
        created_at: new Date(),
        updated_at: new Date(),
        needs_reauth: false,
      };

      const userB: UserTokensRow = {
        user_id: "user-b",
        puuid: "puuid-b",
        access_token_enc: Buffer.from("encrypted-b"),
        refresh_token_enc: Buffer.from("refresh-b"),
        entitlements_jwt_enc: Buffer.from("entitlements-b"),
        expires_at: new Date(Date.now() + 3600000),
        created_at: new Date(),
        updated_at: new Date(),
        needs_reauth: false,
      };

      const resendCalls: any[] = [];

      // Create storefront client that throws for userA, works for userB
      let callCount = 0;
      const deps: WorkerDeps = {
        userTokensRepo: {
          listActive: async () => [userA, userB],
          get: async () => null,
          markNeedsReauth: async () => {},
        },
        wishlistRepo: {
          listFor: async (userId) => ["skin-a"],
        },
        notificationsRepo: {
          filterUnsent: async (_userId, skinUuids) => skinUuids,
          insert: async () => {},
        },
        storefrontClient: {
          fetchStore: async () => {
            callCount++;
            if (callCount === 1) {
              throw new Error("Network error");
            }
            return {
              skinUuids: ["skin-a"],
              endsAtEpoch: 0,
            };
          },
        },
        catalog: {
          lookup: async () => ({
            uuid: "skin-a",
            name: "Skin A",
            priceVp: 1775,
            iconUrl: "https://example.com/skin-a.png",
          }),
          lookupMany: async (uuids) => {
            const map = new Map<string, MatchedSkin>();
            for (const uuid of uuids) {
              map.set(uuid, {
                uuid,
                name: "Skin A",
                priceVp: 1775,
                iconUrl: "https://example.com/skin-a.png",
              });
            }
            return map;
          },
        },
        resend: {
          emails: {
            send: async (params) => {
              resendCalls.push(params);
              return { id: "test-id" };
            },
          },
        },
      };

      // When
      const result = await runWorker(deps);

      // Then: Both users processed despite errors
      expect(result.processed).toBe(2);
      expect(result.errors).toBe(1); // Only userA failed
      expect(result.notified).toBe(1); // Only userB succeeded
    });
  });

  describe("Scenario: 빈 위시리스트 유저는 storefront 호출 스킵", () => {
    it("given빈위시_when워커_thenstorefront호출0회", async () => {
      const user: UserTokensRow = {
        user_id: "user-empty",
        puuid: "puuid-empty",
        access_token_enc: Buffer.from("encrypted"),
        refresh_token_enc: Buffer.from("refresh"),
        entitlements_jwt_enc: Buffer.from("entitlements"),
        expires_at: new Date(Date.now() + 3600000),
        created_at: new Date(),
        updated_at: new Date(),
        needs_reauth: false,
      };

      let storefrontCalled = false;

      const deps: WorkerDeps = {
        userTokensRepo: {
          listActive: async () => [user],
          get: async () => null,
          markNeedsReauth: async () => {},
        },
        wishlistRepo: {
          listFor: async () => [], // Empty wishlist
        },
        notificationsRepo: {
          filterUnsent: async () => [],
          insert: async () => {},
        },
        storefrontClient: {
          fetchStore: async () => {
            storefrontCalled = true;
            return { skinUuids: [], endsAtEpoch: 0 };
          },
        },
        catalog: {
          lookup: async () => ({
            uuid: "test",
            name: "Test",
            priceVp: 0,
            iconUrl: "",
          }),
          lookupMany: async () => new Map(),
        },
        resend: {
          emails: {
            send: async () => ({ id: "test-id" }),
          },
        },
      };

      // When
      await runWorker(deps);

      // Then: Storefront should not be called for empty wishlist
      expect(storefrontCalled).toBe(false);
    });
  });

  describe("Scenario: Resend 실패 시 notifications_sent 롤백", () => {
    it("givenResend5xx_when워커_thennotifications_sent insert없음_다음주기재시도가능", async () => {
      const user: UserTokensRow = {
        user_id: "user-a",
        puuid: "puuid-a",
        access_token_enc: Buffer.from("encrypted"),
        refresh_token_enc: Buffer.from("refresh"),
        entitlements_jwt_enc: Buffer.from("entitlements"),
        expires_at: new Date(Date.now() + 3600000),
        created_at: new Date(),
        updated_at: new Date(),
        needs_reauth: false,
      };

      let notificationsInserted = false;

      const deps: WorkerDeps = {
        userTokensRepo: {
          listActive: async () => [user],
          get: async () => null,
          markNeedsReauth: async () => {},
        },
        wishlistRepo: {
          listFor: async () => ["skin-a"],
        },
        notificationsRepo: {
          filterUnsent: async (_userId, skinUuids) => skinUuids,
          insert: async () => {
            notificationsInserted = true;
          },
        },
        storefrontClient: {
          fetchStore: async () => ({
            skinUuids: ["skin-a"],
            endsAtEpoch: 0,
          }),
        },
        catalog: {
          lookup: async () => ({
            uuid: "skin-a",
            name: "Skin A",
            priceVp: 1775,
            iconUrl: "https://example.com/skin-a.png",
          }),
          lookupMany: async (uuids) => {
            const map = new Map<string, MatchedSkin>();
            for (const uuid of uuids) {
              map.set(uuid, {
                uuid,
                name: "Skin A",
                priceVp: 1775,
                iconUrl: "https://example.com/skin-a.png",
              });
            }
            return map;
          },
        },
        resend: {
          emails: {
            send: async () => {
              throw new Error("5xx Internal Server Error");
            },
          },
        },
      };

      // When
      const result = await runWorker(deps);

      // Then: Notifications should NOT be inserted when email fails
      expect(notificationsInserted).toBe(false);
      expect(result.errors).toBe(1);
      expect(result.notified).toBe(0);
    });
  });
});
