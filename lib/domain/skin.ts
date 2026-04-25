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

/**
 * 크로마 정보
 * FR-9: 스킨 색상 옵션
 */
export type Chroma = {
  uuid: string;
  displayName: string;
  fullRender: string;
  swatch: string | null;
};

/**
 * 스킨 레벨 정보
 * FR-9: 업그레이드 레벨별 이미지
 */
export type SkinLevel = {
  uuid: string;
  displayName: string;
  displayIcon: string | null;
  streamedVideo: string | null;
};

/**
 * 스킨 상세 정보
 * FR-9: 상세 페이지에 필요한 모든 데이터
 */
export type SkinDetail = {
  uuid: string;
  displayName: string;
  displayIcon: string | null;
  chromas: Chroma[];
  levels: SkinLevel[];
  streamedVideo?: string | null;
  contentTierUuid?: string | null;
};
