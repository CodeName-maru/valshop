import type { NightMarketItem } from "@/lib/domain/night-market";

interface NightMarketCardProps {
  item: NightMarketItem;
  skinName?: string;
  tier?: string;
}

/**
 * 야시장 스킨 카드 컴포넌트
 *
 * 할인율 배지, 원가 strikethrough 표시
 */
export function NightMarketCard({ item, skinName = "Unknown Skin", tier = "Unknown" }: NightMarketCardProps) {
  return (
    <div
      data-testid="night-market-card"
      className="relative rounded-lg border border-border bg-card p-4 shadow-sm transition-shadow hover:shadow-md"
    >
      {/* 할인율 배지 */}
      <div className="absolute right-2 top-2 rounded-full bg-red-500 px-2 py-1 text-xs font-bold text-white">
        -{item.discountPercent}%
      </div>

      {/* 스킨 아이콘 (플레이스홀더) */}
      <div className="mb-3 aspect-square w-full rounded bg-muted" />

      {/* 스킨 이름 */}
      <h3 className="mb-2 truncate text-sm font-medium">{skinName}</h3>

      {/* 가격 정보 */}
      <div className="flex items-baseline gap-2">
        <span className="text-lg font-bold text-primary">
          {item.discountedPriceVp} VP
        </span>
        {item.originalPriceVp > item.discountedPriceVp && (
          <span className="text-sm text-muted-foreground line-through">
            {item.originalPriceVp} VP
          </span>
        )}
      </div>

      {/* 등급 표시 */}
      <div className="mt-2 text-xs text-muted-foreground">{tier}</div>
    </div>
  );
}
