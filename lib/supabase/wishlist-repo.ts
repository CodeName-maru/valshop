/**
 * Wishlist Repository
 * Port interface + Supabase adapter for accessing wishlist
 */

/**
 * Port interface for wishlist repository
 */
export interface WishlistRepo {
  /**
   * List all skin UUIDs in user's wishlist
   */
  listFor(userId: string): Promise<string[]>;
}

/**
 * Create Supabase-backed wishlist repository
 * Uses service role key to bypass RLS
 *
 * @param supabase - Supabase client (service role)
 * @returns WishlistRepo instance
 */
export function createWishlistRepo(supabase: any): WishlistRepo {
  return {
    async listFor(userId: string): Promise<string[]> {
      const { data, error } = await supabase
        .from("wishlist")
        .select("skin_uuid")
        .eq("user_id", userId);

      if (error) {
        throw new Error(`Failed to list wishlist: ${error.message}`);
      }

      return (data || []).map((row: any) => row.skin_uuid);
    },
  };
}
