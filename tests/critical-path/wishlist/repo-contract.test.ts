/**
 * Test 1-2: WishlistRepo 포트 계약 (in-memory fake)
 * Plan 0016 Phase 1
 */

import { describe, it, expect } from "vitest";
import {
  createInMemoryWishlistRepo,
  WISHLIST_LIMIT,
  WishlistLimitExceededError,
} from "@/lib/domain/wishlist";

describe("Feature: WishlistRepo 포트 계약 (in-memory fake)", () => {
  it("givenEmptyRepo_whenAddAndList_thenContainsSkin", async () => {
    const repo = createInMemoryWishlistRepo();
    await repo.add("userA", "skin-1");
    expect(await repo.listFor("userA")).toEqual(["skin-1"]);
  });

  it("givenAddedSkin_whenAddSameAgain_thenIdempotentNoDuplicate", async () => {
    const repo = createInMemoryWishlistRepo();
    await repo.add("userA", "skin-1");
    await repo.add("userA", "skin-1");
    expect(await repo.listFor("userA")).toEqual(["skin-1"]);
    expect(await repo.countFor("userA")).toBe(1);
  });

  it("givenAddedSkin_whenRemove_thenListEmpty", async () => {
    const repo = createInMemoryWishlistRepo();
    await repo.add("userA", "skin-1");
    await repo.remove("userA", "skin-1");
    expect(await repo.listFor("userA")).toEqual([]);
  });

  it("givenUserAItem_whenListForUserB_thenReturnsEmpty", async () => {
    const repo = createInMemoryWishlistRepo();
    await repo.add("userA", "skin-1");
    expect(await repo.listFor("userB")).toEqual([]);
  });

  it("givenRepoWith1000Items_whenAdd1001th_thenThrowsLimitExceeded", async () => {
    const repo = createInMemoryWishlistRepo();
    for (let i = 0; i < WISHLIST_LIMIT; i++) {
      await repo.add("userA", `skin-${i}`);
    }
    await expect(repo.add("userA", "skin-extra")).rejects.toBeInstanceOf(
      WishlistLimitExceededError
    );
  });

  it("givenNonExistentSkin_whenRemove_thenIdempotentNoThrow", async () => {
    const repo = createInMemoryWishlistRepo();
    await expect(repo.remove("userA", "nonexistent")).resolves.toBeUndefined();
  });
});
