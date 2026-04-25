/**
 * Valorant API 메타데이터 매칭
 * Storefront 오퍼 UUID와 스킨 카탈로그를 매칭하여 UI용 Skin 도메인 객체 생성
 */

import type { Skin } from "@/lib/domain/skin";
import type { StorefrontOffer } from "@/lib/domain/skin";

/**
 * 스킨 메타데이터 타입 (카탈로그에서 추출)
 */
export type SkinMeta = {
  displayName: string;
  displayIcon: string;
  contentTierUuid: string | null;
};

/**
 * 티어 메타데이터 타입
 */
export type TierMeta = {
  displayIcon: string;
};

/**
 * 스킨 카탈로그(Map<uuid, SkinMeta>)와 티어 카탈로그를 사용하여
 * Storefront 오퍼를 UI용 Skin 도메인 객체로 변환
 *
 * @param offers - Storefront 파싱 오퍼 목록
 * @param skinCatalog - 스킨 메타데이터 맵
 * @param tierCatalog - 티어 메타데이터 맵
 * @returns UI 표시용 Skin 도메인 객체 배열
 */
export function matchSkinMeta(
  offers: StorefrontOffer[],
  skinCatalog: Map<string, SkinMeta>,
  tierCatalog: Map<string, TierMeta>
): Skin[] {
  return offers.map((offer) => {
    const meta = skinCatalog.get(offer.skinUuid);

    if (!meta) {
      // 카탈로그에 없는 스킨 (신규 스킨 등)
      return {
        uuid: offer.skinUuid,
        name: "Unknown Skin",
        priceVp: offer.priceVp,
        imageUrl: "/placeholder.png",
        tierIconUrl: null,
      };
    }

    // 티어 아이콘 찾기
    let tierIconUrl: string | null = null;
    if (meta.contentTierUuid) {
      const tierMeta = tierCatalog.get(meta.contentTierUuid);
      if (tierMeta) {
        tierIconUrl = tierMeta.displayIcon;
      }
    }

    return {
      uuid: offer.skinUuid,
      name: meta.displayName,
      priceVp: offer.priceVp,
      imageUrl: meta.displayIcon,
      tierIconUrl,
    };
  });
}

// 타입 내보내기 (테스트에서 사용)
export type { Skin };
