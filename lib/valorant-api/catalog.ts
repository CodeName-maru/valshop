/**
 * Valorant API Catalog
 * Provides skin metadata (name, icon, tier) from valorant-api.com
 */

import type { Skin } from "@/lib/domain/skin";
import type { MatchedSkin } from "@/lib/domain/wishlist";

/**
 * Catalog lookup port interface
 */
export interface Catalog {
  /**
   * Lookup skin metadata by UUID
   */
  lookup(uuid: string): Promise<MatchedSkin | null>;

  /**
   * Lookup multiple skin metadata by UUIDs
   */
  lookupMany(uuids: string[]): Promise<Map<string, MatchedSkin>>;
}

/**
 * Real catalog implementation using valorant-api.com
 * Uses Next.js ISR caching
 */
export class ValorantApiCatalog implements Catalog {
  private cache = new Map<string, MatchedSkin>();

  async lookup(uuid: string): Promise<MatchedSkin | null> {
    // Check cache first
    if (this.cache.has(uuid)) {
      return this.cache.get(uuid)!;
    }

    try {
      const response = await fetch(`https://valorant-api.com/v1/weapons/skins/${uuid}`, {
        next: { revalidate: 86400 }, // 24 hours
      });

      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      const skin = this.parseSkin(data);

      if (skin) {
        this.cache.set(uuid, skin);
      }

      return skin;
    } catch {
      return null;
    }
  }

  async lookupMany(uuids: string[]): Promise<Map<string, MatchedSkin>> {
    const result = new Map<string, MatchedSkin>();

    // Batch lookup would be more efficient, but valorant-api doesn't support it
    // For now, use parallel individual lookups
    await Promise.all(
      uuids.map(async (uuid) => {
        const skin = await this.lookup(uuid);
        if (skin) {
          result.set(uuid, skin);
        }
      })
    );

    return result;
  }

  private parseSkin(data: any): MatchedSkin | null {
    if (!data || !data.data) {
      return null;
    }

    const skin = data.data;
    return {
      uuid: skin.uuid,
      name: skin.displayName || "Unknown Skin",
      priceVp: 0, // Price is not in this endpoint
      iconUrl: skin.displayIcon || "/placeholder.png",
    };
  }
}

/**
 * Get detailed skin information
 * TODO: Implement full skin details with price, tier, rarity, etc.
 * Currently returns a placeholder
 */
export async function getSkinDetail(uuid: string): Promise<MatchedSkin | null> {
  // Placeholder implementation
  return {
    uuid,
    name: "Unknown Skin",
    priceVp: 0,
    iconUrl: "/placeholder.png",
  };
}

/**
 * Create singleton catalog instance
 */
export function createCatalog(): Catalog {
  return new ValorantApiCatalog();
}
