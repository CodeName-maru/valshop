/**
 * Riot Storefront API 파싱 및 호출
 * Phase 1: 순수 파싱 함수
 * Phase 3: Store Proxy 호출
 */

import type { StorefrontOffer, TodayStore } from "@/lib/domain/skin";
import type { SessionPayload } from "@/lib/session/types";
import type { RiotFetcher } from "./fetcher";
import { getClientVersion } from "./version";
import { getSkinCatalog, getTierCatalog } from "@/lib/valorant-api/catalog";
import { matchSkinMeta } from "@/lib/valorant-api/match";

/**
 * Storefront 응답 파싱 에러
 */
export class StorefrontParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorefrontParseError";
  }
}

/**
 * Riot Storefront JSON 응답 타입 (내부 사용)
 */
interface StorefrontJson {
  SkinsPanelLayout: {
    SingleItemStoreOffers: Array<{
      OfferID: string;
      Costs?: Array<{ CurrencyID: string; Amount: number }>;
    }>;
    SingleItemOffersRemainingDurationInSeconds: number;
  };
}

/**
 * Riot Storefront JSON 응답을 파싱하여 오퍼 목록과 로테이션 종료 시간을 추출
 * @param json - Riot Storefront API 응답
 * @param now - 기준 시간 (기본값: 현재 시간)
 * @returns 파싱된 오퍼 목록과 로테이션 종료 시간
 * @throws {StorefrontParseError} 필수 필드 누락 시
 */
export function parseStorefront(
  json: unknown,
  now: Date = new Date()
): { offers: StorefrontOffer[]; rotationEndsAt: Date } {
  // SkinsPanelLayout 검증
  if (!json || typeof json !== "object") {
    throw new StorefrontParseError("Invalid storefront response: not an object");
  }

  const data = json as Partial<StorefrontJson>;
  const skinsPanel = data.SkinsPanelLayout;

  if (!skinsPanel || typeof skinsPanel !== "object") {
    throw new StorefrontParseError("Missing SkinsPanelLayout in response");
  }

  const offers = skinsPanel.SingleItemStoreOffers;
  if (!Array.isArray(offers)) {
    throw new StorefrontParseError(
      "SingleItemStoreOffers is not an array"
    );
  }

  // 로테이션 종료 시간 계산
  const remainingSeconds =
    skinsPanel.SingleItemOffersRemainingDurationInSeconds ?? 0;
  const rotationEndsAt = new Date(now.getTime() + remainingSeconds * 1000);

  // 오퍼 파싱
  const parsedOffers: StorefrontOffer[] = offers.map((offer) => {
    if (!offer.OfferID) {
      throw new StorefrontParseError("Offer missing OfferID");
    }

    // Costs가 있으면 VP 가격 추출, 없으면 0
    let priceVp = 0;
    if (
      offer.Costs &&
      Array.isArray(offer.Costs) &&
      offer.Costs.length > 0
    ) {
      const vpCost = offer.Costs.find((c) => c.CurrencyID === "85ad13f7-3d1b-5128-9eb2-7cd8ee0b5741"); // VP UUID
      if (vpCost) {
        priceVp = vpCost.Amount;
      }
    }

    return {
      skinUuid: offer.OfferID,
      priceVp,
    };
  });

  return {
    offers: parsedOffers,
    rotationEndsAt,
  };
}

/**
 * 오늘의 상점 조회
 * Riot Storefront API 호출 → 파싱 → 메타 매칭
 *
 * @param session - 사용자 세션
 * @param deps - 의존성 (fetcher 포트)
 * @returns 오늘의 상점 정보
 * @throws {RiotApiError} Riot API 에러 발생 시
 */
export async function getTodayStore(
  session: SessionPayload,
  deps: { fetcher: RiotFetcher }
): Promise<TodayStore> {
  // 병렬로 메타 데이터와 버전 조회
  const [skinCatalog, tierCatalog, clientVersion] = await Promise.all([
    getSkinCatalog(),
    getTierCatalog(),
    getClientVersion(),
  ]);

  // Storefront URL
  const region = session.region || "kr";
  const storefrontUrl = `https://pd.${region}.a.pvp.net/store/v2/storefront/${session.puuid}`;

  // RiotFetcher를 통한 storefront 호출
  const storefrontJson = await deps.fetcher.get(storefrontUrl, session, clientVersion);

  // 파싱
  const { offers, rotationEndsAt } = parseStorefront(storefrontJson);

  // 메타 매칭
  const skins = matchSkinMeta(offers, skinCatalog, tierCatalog);

  return {
    offers: skins,
    rotationEndsAt,
  };
}
