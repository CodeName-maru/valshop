"use client";

import { NightMarketCard } from "@/components/NightMarketCard";
import { Countdown } from "@/components/Countdown";
import type { NightMarket, SkinMeta } from "@/lib/domain/night-market";

interface NightMarketViewProps {
  market: NightMarket;
  metaBySkin: Record<string, SkinMeta>;
}

/**
 * 야시장 뷰 컴포넌트
 *
 * 6개 카드 + 남은 시간 countdown
 */
export function NightMarketView({ market, metaBySkin }: NightMarketViewProps) {
  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="mb-4 text-2xl font-bold">야시장</h1>

      {/* 남은 시간 카운트다운 */}
      <div className="mb-6 rounded-lg bg-card p-4 shadow-sm">
        <p className="text-sm text-muted-foreground">
          남은 시간:{" "}
          <Countdown endsAtEpochMs={market.endsAtEpochMs} />
        </p>
      </div>

      {/* 6개 카드 그리드 */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {market.items.map((item) => {
          const meta = metaBySkin[item.skinUuid];
          const props = {
            key: item.skinUuid,
            item,
            ...(meta ? { skinName: meta.name, tier: meta.tier } : {}),
          };
          return <NightMarketCard {...props} />;
        })}
      </div>
    </div>
  );
}
