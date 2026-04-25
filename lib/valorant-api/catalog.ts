/**
 * Valorant API Catalog
 * Provides skin metadata (name, icon, tier) from valorant-api.com
 * FR-9: 스킨 상세 조회 (크로마, 레벨, 영상 링크)
 */

import type { SkinMeta, TierMeta } from "./match";
import type { Skin, SkinDetail, Chroma, SkinLevel } from "@/lib/domain/skin";
import type { MatchedSkin } from "@/lib/domain/wishlist";

/**
 * 스킨 카탈로그 fetch
 * @returns Map<uuid, SkinMeta>
 */
export async function getSkinCatalog(): Promise<Map<string, SkinMeta>> {
  const response = await fetch("https://valorant-api.com/v1/weapons/skins", {
    next: { revalidate: 86400 }, // 24 hours
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch skin catalog: ${response.status}`);
  }

  const json = (await response.json()) as {
    data: Array<{
      uuid: string;
      displayName: string;
      displayIcon: string | null;
      contentTierUuid: string | null;
    }>;
  };
  const data = json.data;

  const catalog = new Map<string, SkinMeta>();
  for (const skin of data) {
    catalog.set(skin.uuid, {
      displayName: skin.displayName,
      displayIcon: skin.displayIcon || "/placeholder.png",
      contentTierUuid: skin.contentTierUuid,
    });
  }

  return catalog;
}

/**
 * 티어 카탈로그 fetch
 * @returns Map<uuid, TierMeta>
 */
export async function getTierCatalog(): Promise<Map<string, TierMeta>> {
  const response = await fetch("https://valorant-api.com/v1/contenttiers", {
    next: { revalidate: 86400 }, // 24 hours
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch tier catalog: ${response.status}`);
  }

  const json = (await response.json()) as {
    data: Array<{
      uuid: string;
      displayName: string;
      displayIcon: string | null;
    }>;
  };
  const data = json.data;

  const catalog = new Map<string, TierMeta>();
  for (const tier of data) {
    if (tier.displayIcon) {
      catalog.set(tier.uuid, {
        displayIcon: tier.displayIcon,
      });
    }
  }

  return catalog;
}

/**
 * FR-9: Get detailed skin information including chromas, levels, and video
 * Uses ISR caching (24h) for performance
 *
 * @param uuid - Skin UUID
 * @returns SkinDetail or null if not found
 */
export async function getSkinDetail(uuid: string): Promise<SkinDetail | null> {
  try {
    const response = await fetch(
      `https://valorant-api.com/v1/weapons/skins/${uuid}`,
      {
        next: { revalidate: 86400 }, // 24 hours (ADR-0003)
      }
    );

    if (!response.ok) {
      return null;
    }

    interface RawChroma {
      uuid: string;
      displayName: string | null;
      fullRender: string | null;
      swatch: string | null;
    }
    interface RawLevel {
      uuid: string;
      displayName: string | null;
      displayIcon: string | null;
      streamedVideo: string | null;
    }
    interface RawSkinDetail {
      uuid: string;
      displayName: string | null;
      displayIcon: string | null;
      chromas?: RawChroma[];
      levels?: RawLevel[];
      streamedVideo: string | null;
      contentTierUuid: string | null;
    }
    const data = (await response.json()) as { data?: RawSkinDetail } | null;

    if (!data || !data.data) {
      return null;
    }

    const skin = data.data;
    return {
      uuid: skin.uuid,
      displayName: skin.displayName || "Unknown Skin",
      displayIcon: skin.displayIcon || null,
      chromas: (skin.chromas ?? []).map((chroma) => ({
        uuid: chroma.uuid,
        displayName: chroma.displayName || "Chroma",
        fullRender: chroma.fullRender || "",
        swatch: chroma.swatch || null,
      })),
      levels: (skin.levels ?? []).map((level) => ({
        uuid: level.uuid,
        displayName: level.displayName || "Level",
        displayIcon: level.displayIcon || null,
        streamedVideo: level.streamedVideo || null,
      })),
      streamedVideo: skin.streamedVideo || null,
      contentTierUuid: skin.contentTierUuid || null,
    };
  } catch {
    return null;
  }
}

/**
 * Catalog lookup port interface
 * Used by wishlist worker to look up skin metadata
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

      const data = (await response.json()) as unknown;
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

  private parseSkin(data: unknown): MatchedSkin | null {
    if (!data || typeof data !== "object" || !("data" in data)) {
      return null;
    }
    const inner = data.data;
    if (!inner || typeof inner !== "object") {
      return null;
    }
    const skin = inner as {
      uuid: string;
      displayName?: string;
      displayIcon?: string;
    };
    return {
      uuid: skin.uuid,
      name: skin.displayName || "Unknown Skin",
      priceVp: 0, // Price is not in this endpoint
      iconUrl: skin.displayIcon || "/placeholder.png",
    };
  }
}

/**
 * Create singleton catalog instance
 */
export function createCatalog(): Catalog {
  return new ValorantApiCatalog();
}
