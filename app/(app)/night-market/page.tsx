import { redirect } from "next/navigation";
import { NightMarketView } from "./view";
import { getNightMarket } from "@/lib/riot/night-market";

/**
 * 야시장 페이지
 *
 * 야시장 비활성 시 /dashboard 로 리다이렉트
 */
export default async function NightMarketPage() {
  const nightMarketState = await getNightMarket();

  if (!nightMarketState.active) {
    redirect("/dashboard");
  }

  // TODO: 메타 데이터 로드
  const metaBySkin: Record<string, any> = {};

  return <NightMarketView market={nightMarketState.market} metaBySkin={metaBySkin} />;
}
