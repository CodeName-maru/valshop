/**
 * 야시장 도메인 타입
 *
 * FR-3의 storefront 응답 파서 확장
 */

export interface NightMarketItem {
  skinUuid: string; // Offer.Rewards[0].ItemID
  originalPriceVp: number; // DiscountCosts.<VP UUID> 이전 원가
  discountedPriceVp: number; // DiscountCosts.<VP UUID>
  discountPercent: number; // DiscountPercent (0~100 정수)
  isRevealed: boolean; // IsSeen
}

export interface NightMarket {
  items: NightMarketItem[]; // 항상 6개 기대, 실제 length 로 검증
  endsAtEpochMs: number; // BonusStoreRemainingDurationInSeconds → 절대시각
}

export type NightMarketState =
  | { active: false }
  | { active: true; market: NightMarket };

/**
 * 스킨 메타 타입
 */
export interface SkinMeta {
  uuid: string;
  name: string;
  tier: string;
  iconUrl?: string;
}

/**
 * 야시장 활성 상태 가드
 */
export function isActive(state: NightMarketState): state is { active: true; market: NightMarket } {
  return state.active;
}
