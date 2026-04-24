/**
 * Valorant API 메타 카탈로그 fetch
 * ISR (Incremental Static Regeneration) 캐시로 24시간 주기로 갱신
 */

import type { SkinMeta, TierMeta } from "./match";

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

  const json = await response.json();
  const data = json.data as Array<{
    uuid: string;
    displayName: string;
    displayIcon: string | null;
    contentTierUuid: string | null;
  }>;

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

  const json = await response.json();
  const data = json.data as Array<{
    uuid: string;
    displayName: string;
    displayIcon: string | null;
  }>;

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
