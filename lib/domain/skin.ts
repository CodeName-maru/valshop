/**
 * Domain: Skin & Store 도메인 타입
 * FR-3: 오늘의 상점 4개 카드 렌더
 */

/**
 * 스킨 도메인 객체
 * UI에 표시할 스킨의 모든 정보를 포함
 */
export type Skin = {
  uuid: string;
  name: string;
  priceVp: number;
  imageUrl: string;
  tierIconUrl: string | null;
};

/**
 * 오늘의 상점 정보
 * 4개 스킨 오퍼와 로테이션 종료 시간을 포함
 */
export type TodayStore = {
  offers: Skin[];
  rotationEndsAt: Date;
};

/**
 * Riot Storefront 응답에서 파싱한 오퍼 정보
 * 메타데이터 매칭 전 단계
 */
export type StorefrontOffer = {
  skinUuid: string;
  priceVp: number;
};
