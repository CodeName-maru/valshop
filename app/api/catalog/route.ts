/**
 * Catalog Route — public 카탈로그 (Plan 0016)
 *
 * GET /api/catalog → { skins: Skin[] }
 * - 카탈로그를 ISR 로 1회 fetch 후 Skin[] 으로 정규화하여 반환
 * - 인증 불필요 (검색 페이지에서 사용)
 */

import { NextResponse } from "next/server";
import { getSkinCatalog, getTierCatalog } from "@/lib/valorant-api/catalog";
import type { Skin } from "@/lib/domain/skin";

export const runtime = "nodejs";
export const revalidate = 86400;

export async function GET(): Promise<NextResponse> {
  try {
    const [skins, tiers] = await Promise.all([getSkinCatalog(), getTierCatalog()]);
    const out: Skin[] = [];
    for (const [uuid, meta] of skins) {
      out.push({
        uuid,
        name: meta.displayName,
        priceVp: 0, // 카탈로그에는 가격 없음 (검색 용도)
        imageUrl: meta.displayIcon,
        tierIconUrl: meta.contentTierUuid
          ? tiers.get(meta.contentTierUuid)?.displayIcon ?? null
          : null,
      });
    }
    return NextResponse.json(
      { skins: out },
      {
        headers: {
          "cache-control": "public, max-age=3600, stale-while-revalidate=86400",
        },
      }
    );
  } catch {
    return NextResponse.json({ error: "catalog_unavailable" }, { status: 503 });
  }
}
