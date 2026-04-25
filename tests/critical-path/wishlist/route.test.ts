/**
 * Tests 2-1 ~ 2-7: /api/wishlist Route Handlers
 * Plan 0016 Phase 2
 *
 * 모듈을 mock 으로 격리하여 fake repo + fake resolver 로 동작 검증.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { testApiHandler } from "next-test-api-route-handler";
import {
  WISHLIST_LIMIT,
  WishlistLimitExceededError,
  createInMemoryWishlistRepo,
  type WishlistRepo,
} from "@/lib/domain/wishlist";

// ─── 모듈 mock ─────────────────────────────────────────────────────────
vi.mock("@/lib/session/guard", () => ({
  getSession: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createServiceRoleClient: vi.fn(() => ({})),
}));
vi.mock("@/lib/wishlist/resolve-user", () => ({
  resolveUserIdFromSession: vi.fn(),
  _resetResolveUserCache: vi.fn(),
}));
vi.mock("@/lib/wishlist/rate-limit", () => ({
  tryConsume: vi.fn(() => true),
  _resetRateLimit: vi.fn(),
}));
vi.mock("@/lib/valorant-api/catalog", () => ({
  getSkinCatalog: vi.fn(),
}));

let activeRepo: WishlistRepo = createInMemoryWishlistRepo();
let repoFactory: (sb: any) => WishlistRepo = () => activeRepo;
vi.mock("@/lib/supabase/wishlist-repo", () => ({
  createWishlistRepo: (sb: any) => repoFactory(sb),
}));

import * as collectionRoute from "@/app/api/wishlist/route";
import * as itemRoute from "@/app/api/wishlist/[skinId]/route";
import { getSession } from "@/lib/session/guard";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { resolveUserIdFromSession } from "@/lib/wishlist/resolve-user";
import { tryConsume } from "@/lib/wishlist/rate-limit";
import { getSkinCatalog } from "@/lib/valorant-api/catalog";

const VALID_SESSION = {
  puuid: "puuid-A",
  accessToken: "tok",
  entitlementsJwt: "ent",
  expiresAt: Math.floor(Date.now() / 1000) + 3600,
  region: "kr",
};
const USER_A = "user-A";

function setHappyDefaults() {
  (getSession as any).mockResolvedValue(VALID_SESSION);
  (createServiceRoleClient as any).mockReturnValue({});
  (resolveUserIdFromSession as any).mockResolvedValue(USER_A);
  (tryConsume as any).mockReturnValue(true);
  (getSkinCatalog as any).mockResolvedValue(
    new Map([["skin-1", {}], ["skin-2", {}], ["skin-X", {}]])
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  activeRepo = createInMemoryWishlistRepo();
  repoFactory = () => activeRepo;
  setHappyDefaults();
});

// ─── Test 2-1: 인증 경계 ──────────────────────────────────────────────
describe("Feature: /api/wishlist 인증", () => {
  it("givenNoSessionCookie_whenGET_then401WithUnauthorizedCode", async () => {
    (getSession as any).mockResolvedValue(null);
    await testApiHandler({
      appHandler: collectionRoute,
      async test({ fetch }) {
        const res = await fetch({ method: "GET" });
        expect(res.status).toBe(401);
        const body = await res.json();
        expect(body.error).toBe("unauthorized");
      },
    });
  });

  it("givenSessionWithUnknownPuuid_whenGET_then401", async () => {
    (resolveUserIdFromSession as any).mockResolvedValue(null);
    await testApiHandler({
      appHandler: collectionRoute,
      async test({ fetch }) {
        const res = await fetch({ method: "GET" });
        expect(res.status).toBe(401);
      },
    });
  });
});

// ─── Test 2-2: GET happy path ─────────────────────────────────────────
describe("Feature: /api/wishlist GET", () => {
  it("givenValidSession_whenGET_thenReturnsSkinsArrayForResolvedUser", async () => {
    await activeRepo.add(USER_A, "skin-1");
    await activeRepo.add(USER_A, "skin-2");
    await testApiHandler({
      appHandler: collectionRoute,
      async test({ fetch }) {
        const res = await fetch({ method: "GET" });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.skins.sort()).toEqual(["skin-1", "skin-2"]);
      },
    });
  });

  it("givenValidSessionEmptyWishlist_whenGET_thenReturnsEmptyArray", async () => {
    await testApiHandler({
      appHandler: collectionRoute,
      async test({ fetch }) {
        const res = await fetch({ method: "GET" });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.skins).toEqual([]);
      },
    });
  });
});

// ─── Test 2-3: POST 본인성 + 멱등성 ──────────────────────────────────
describe("Feature: /api/wishlist POST", () => {
  it("givenValidSession_whenPOSTWithSkinId_thenRepoAddCalledWithResolvedUserId", async () => {
    await testApiHandler({
      appHandler: collectionRoute,
      async test({ fetch }) {
        const res = await fetch({
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ skinId: "skin-1" }),
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.ok).toBe(true);
        expect(await activeRepo.listFor(USER_A)).toEqual(["skin-1"]);
      },
    });
  });

  it("givenValidSession_whenPOSTSameSkinTwice_thenIdempotent200", async () => {
    await testApiHandler({
      appHandler: collectionRoute,
      async test({ fetch }) {
        const r1 = await fetch({
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ skinId: "skin-1" }),
        });
        expect(r1.status).toBe(200);
        const r2 = await fetch({
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ skinId: "skin-1" }),
        });
        expect(r2.status).toBe(200);
        expect(await activeRepo.countFor(USER_A)).toBe(1);
      },
    });
  });

  it("givenValidSession_whenPOSTWithoutSkinId_then400BadRequest", async () => {
    await testApiHandler({
      appHandler: collectionRoute,
      async test({ fetch }) {
        const res = await fetch({
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        });
        expect(res.status).toBe(400);
      },
    });
  });

  it("givenValidSession_whenPOSTWithSkinIdNotInCatalog_then404SkinNotFound", async () => {
    await testApiHandler({
      appHandler: collectionRoute,
      async test({ fetch }) {
        const res = await fetch({
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ skinId: "ghost-skin" }),
        });
        expect(res.status).toBe(404);
        const body = await res.json();
        expect(body.error).toBe("skin_not_found");
      },
    });
  });

  it("givenAttackerForgesUserIdInBody_whenPOST_thenIgnoredUserIdComesFromSession", async () => {
    await testApiHandler({
      appHandler: collectionRoute,
      async test({ fetch }) {
        const res = await fetch({
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ skinId: "skin-1", userId: "user-EVIL" }),
        });
        expect(res.status).toBe(200);
        // user-A 에만 추가되어야 함
        expect(await activeRepo.listFor(USER_A)).toEqual(["skin-1"]);
        expect(await activeRepo.listFor("user-EVIL")).toEqual([]);
      },
    });
  });
});

// ─── Test 2-4: Scale 한도 ─────────────────────────────────────────────
describe("Feature: /api/wishlist POST 1000 한도", () => {
  it("given1000ExistingItems_whenPOST1001th_then422LimitExceeded", async () => {
    // limit 강제: fake 가 throw 하도록 add 를 wrap
    const proxied: WishlistRepo = {
      ...activeRepo,
      add: async (uid, sid) => {
        if (uid === USER_A) throw new WishlistLimitExceededError();
        return activeRepo.add(uid, sid);
      },
    };
    repoFactory = () => proxied;
    await testApiHandler({
      appHandler: collectionRoute,
      async test({ fetch }) {
        const res = await fetch({
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ skinId: "skin-1" }),
        });
        expect(res.status).toBe(422);
        const body = await res.json();
        expect(body.error).toBe("wishlist_limit_exceeded");
      },
    });
    // 사용 변수
    void WISHLIST_LIMIT;
  });
});

// ─── Test 2-5: Availability — Supabase 장애 ──────────────────────────
describe("Feature: /api/wishlist Supabase 장애", () => {
  it("givenSupabaseThrows_whenGET_then503WishlistUnavailable", async () => {
    const failing: WishlistRepo = {
      ...activeRepo,
      listFor: async () => {
        throw new Error("supabase down");
      },
    };
    repoFactory = () => failing;
    await testApiHandler({
      appHandler: collectionRoute,
      async test({ fetch }) {
        const res = await fetch({ method: "GET" });
        expect(res.status).toBe(503);
        const body = await res.json();
        expect(body.error).toBe("wishlist_unavailable");
      },
    });
  });

  it("givenSupabaseThrows_whenPOST_then503WishlistUnavailable", async () => {
    const failing: WishlistRepo = {
      ...activeRepo,
      add: async () => {
        throw new Error("supabase down");
      },
    };
    repoFactory = () => failing;
    await testApiHandler({
      appHandler: collectionRoute,
      async test({ fetch }) {
        const res = await fetch({
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ skinId: "skin-1" }),
        });
        expect(res.status).toBe(503);
      },
    });
  });
});

// ─── Test 2-6: DELETE ─────────────────────────────────────────────────
describe("Feature: /api/wishlist/[skinId] DELETE", () => {
  it("givenValidSession_whenDELETEWithSkinIdParam_thenRepoRemoveCalled204", async () => {
    await activeRepo.add(USER_A, "skin-1");
    await testApiHandler({
      appHandler: itemRoute,
      params: { skinId: "skin-1" },
      async test({ fetch }) {
        const res = await fetch({ method: "DELETE" });
        expect(res.status).toBe(204);
        expect(await activeRepo.listFor(USER_A)).toEqual([]);
      },
    });
  });

  it("givenValidSession_whenDELETENonExistentSkin_then204Idempotent", async () => {
    await testApiHandler({
      appHandler: itemRoute,
      params: { skinId: "nonexistent" },
      async test({ fetch }) {
        const res = await fetch({ method: "DELETE" });
        expect(res.status).toBe(204);
      },
    });
  });

  it("givenNoSession_whenDELETE_then401", async () => {
    (getSession as any).mockResolvedValue(null);
    await testApiHandler({
      appHandler: itemRoute,
      params: { skinId: "skin-1" },
      async test({ fetch }) {
        const res = await fetch({ method: "DELETE" });
        expect(res.status).toBe(401);
      },
    });
  });
});

// ─── Test 2-7: Rate limit ─────────────────────────────────────────────
describe("Feature: /api/wishlist rate limit", () => {
  it("givenSameUser_when11POSTsIn1Sec_then11thReturns429", async () => {
    let calls = 0;
    (tryConsume as any).mockImplementation(() => {
      calls++;
      return calls <= 10;
    });
    await testApiHandler({
      appHandler: collectionRoute,
      async test({ fetch }) {
        for (let i = 0; i < 10; i++) {
          const res = await fetch({
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ skinId: "skin-1" }),
          });
          expect(res.status).toBe(200);
        }
        const res = await fetch({
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ skinId: "skin-1" }),
        });
        expect(res.status).toBe(429);
      },
    });
  });
});
