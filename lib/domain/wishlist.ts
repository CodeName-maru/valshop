/**
 * Domain: Wishlist & Store Matching
 * FR-7: Wishlist CRUD (add/remove/list) — in-memory port + fake (Plan 0016)
 * FR-8: Store polling worker matches store items against user wishlist
 */

import type { Skin } from "./skin";

// ─── Plan 0016: 위시리스트 CRUD 도메인 ─────────────────────────────────────

/** 위시리스트 한도 (Scale NFR: ~1000 레코드/유저) */
export const WISHLIST_LIMIT = 1000;

/** 1000 한도 초과 시 throw */
export class WishlistLimitExceededError extends Error {
  constructor(message = "wishlist_limit_exceeded") {
    super(message);
    this.name = "WishlistLimitExceededError";
  }
}

/** 위시리스트 항목 (DB row 의 도메인 표현) */
export interface WishlistItem {
  userId: string;
  skinUuid: string;
  createdAt: string;
}

/**
 * WishlistRepo 포트
 * - Plan 0016 의 어댑터/fake 가 모두 이 인터페이스를 구현한다.
 * - 기존 worker (`lib/worker/check-wishlist.ts`) 는 listFor 만 사용하므로
 *   필수 메서드는 listFor 이고 add/remove/countFor 는 본 plan 에서 추가된다.
 */
export interface WishlistRepo {
  /** add 멱등 — 이미 존재하면 no-op. 1000 초과 시 WishlistLimitExceededError. */
  add(userId: string, skinUuid: string): Promise<void>;
  /** remove 멱등 — 존재하지 않아도 no-op. */
  remove(userId: string, skinUuid: string): Promise<void>;
  /** 사용자의 모든 skinUuid (정렬 보장 X). */
  listFor(userId: string): Promise<string[]>;
  /** 사용자의 위시리스트 row 수. */
  countFor(userId: string): Promise<number>;
}

/**
 * 카탈로그 검색 (순수 함수)
 * - name 정규화 (소문자 + 트림) 후 substring 매칭
 * - 빈 쿼리/공백만 → 원본 전체 반환
 * - 원본 배열은 변경하지 않음 (immutability)
 */
export function filterSkinsByQuery(skins: Skin[], q: string): Skin[] {
  const norm = (q ?? "").toLowerCase().trim();
  if (norm === "") {
    return skins.slice();
  }
  return skins.filter((s) => s.name.toLowerCase().includes(norm));
}

/**
 * In-memory fake repo (critical-path 테스트용 + 로컬 dev fallback)
 * - Map<userId, Set<skinUuid>> 백킹
 * - WISHLIST_LIMIT 강제
 */
export function createInMemoryWishlistRepo(): WishlistRepo {
  const store = new Map<string, Set<string>>();
  const ensure = (userId: string) => {
    let set = store.get(userId);
    if (!set) {
      set = new Set<string>();
      store.set(userId, set);
    }
    return set;
  };
  return {
    add(userId, skinUuid) {
      const set = ensure(userId);
      if (set.has(skinUuid)) return Promise.resolve();
      if (set.size >= WISHLIST_LIMIT) {
        return Promise.reject(new WishlistLimitExceededError());
      }
      set.add(skinUuid);
      return Promise.resolve();
    },
    remove(userId, skinUuid) {
      const set = store.get(userId);
      if (!set) return Promise.resolve();
      set.delete(skinUuid);
      return Promise.resolve();
    },
    listFor(userId) {
      const set = store.get(userId);
      return Promise.resolve(set ? Array.from(set) : []);
    },
    countFor(userId) {
      const set = store.get(userId);
      return Promise.resolve(set ? set.size : 0);
    },
  };
}

// ─── 기존 (Worker / Plan 0008) ─────────────────────────────────────────────

/**
 * Matched skin with metadata for email notification
 */
export type MatchedSkin = {
  uuid: string;
  name: string;
  priceVp: number;
  iconUrl: string;
};

/**
 * Match store items against wishlist
 * Returns array of skin UUIDs that exist in both store and wishlist
 *
 * @param storeSkinUuids - Skin UUIDs available in today's store
 * @param wishlistSkinUuids - Skin UUIDs in user's wishlist
 * @returns Array of matching skin UUIDs
 *
 * @example
 * const store = ["uuid-a", "uuid-b", "uuid-c"];
 * const wishlist = ["uuid-b", "uuid-z"];
 * const matched = matchStoreAgainstWishlist(store, wishlist);
 * // => ["uuid-b"]
 */
export function matchStoreAgainstWishlist(
  storeSkinUuids: string[],
  wishlistSkinUuids: string[]
): string[] {
  if (storeSkinUuids.length === 0 || wishlistSkinUuids.length === 0) {
    return [];
  }

  const wishlistSet = new Set(wishlistSkinUuids);
  return storeSkinUuids.filter((uuid) => wishlistSet.has(uuid));
}
