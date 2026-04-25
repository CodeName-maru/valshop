/**
 * 야시장 파서
 *
 * FR-3의 storefront 응답에서 BonusStore 노드를 파싱
 */

import type { NightMarketState, NightMarket, NightMarketItem } from "../domain/night-market";

// VP UUID (고정값)
const VP_UUID = "85ad13f7-3d1b-508f-8c90-63da8c3c76d5";

// 할인율별 원가 계산 (데이터 수집 필요, 임시값)
// TODO: 실제 스킨별 원가 데이터 필요
function calculateOriginalPrice(discountedPrice: number, discountPercent: number): number {
  // 할인율이 적용된 가격에서 원가를 역산
  // discountedPrice = originalPrice * (1 - discountPercent / 100)
  // originalPrice = discountedPrice / (1 - discountPercent / 100)
  return Math.round(discountedPrice / (1 - discountPercent / 100));
}

/**
 * storefront 응답에서 야시장 상태 파싱
 */
export function parseNightMarket(storefrontJson: any): NightMarketState {
  const bonusStore = storefrontJson?.BonusStore;

  if (!bonusStore || !bonusStore.BonusStoreOffers) {
    return { active: false };
  }

  const offers = bonusStore.BonusStoreOffers;

  if (offers.length === 0) {
    return { active: false };
  }

  const items: NightMarketItem[] = offers.map((offer: any) => {
    const offerData = offer.Offer;
    const reward = offerData.Rewards?.[0];

    const discountedPrice = offerData.Cost?.[VP_UUID] ?? 0;
    const discountPercent = offerData.DiscountPercent ?? 0;
    const originalPrice = calculateOriginalPrice(discountedPrice, discountPercent);

    return {
      skinUuid: reward?.ItemID ?? "",
      originalPriceVp: originalPrice,
      discountedPriceVp: discountedPrice,
      discountPercent,
      isRevealed: offerData.IsSeen ?? false,
    };
  });

  const remainingSeconds = bonusStore.BonusStoreRemainingDurationInSeconds ?? 0;
  const endsAtEpochMs = Date.now() + remainingSeconds * 1000;

  return {
    active: true,
    market: {
      items,
      endsAtEpochMs,
    },
  };
}

/**
 * 야시장 상태 조회 (TODO: 실제 API 연동 필요)
 */
export function getNightMarket(): Promise<NightMarketState> {
  // TODO: 실제로는 /api/store 에서 nightMarket 필드를 가져옴
  // 현재는 임시로 비활성 상태 반환
  return Promise.resolve({ active: false });
}
