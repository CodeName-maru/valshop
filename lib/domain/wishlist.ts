/**
 * Domain: Wishlist & Store Matching
 * FR-8: Store polling worker matches store items against user wishlist
 */

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
