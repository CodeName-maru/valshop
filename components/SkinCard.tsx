/**
 * SkinCard 컴포넌트
 * 오늘의 상점 스킨 카드
 */

import Image from "next/image";
import type { Skin } from "@/lib/domain/skin";
import { Card, CardContent } from "@/components/ui/card";

interface SkinCardProps {
  skin: Skin;
  priority?: boolean;
}

export function SkinCard({ skin, priority = false }: SkinCardProps) {
  // 가격 포맷 (천단위 콤마)
  const formattedPrice = new Intl.NumberFormat("ko-KR").format(skin.priceVp);

  return (
    <Card data-testid="skin-card" className="overflow-hidden">
      <CardContent className="p-0">
        <div className="relative aspect-square bg-slate-100">
          <Image
            src={skin.imageUrl}
            alt={skin.name}
            fill
            sizes="(max-width: 640px) 50vw, 25vw"
            priority={priority}
            className="object-cover"
          />
          {skin.tierIconUrl && (
            <div className="absolute top-2 right-2">
              <Image
                src={skin.tierIconUrl}
                alt="Tier"
                width={24}
                height={24}
                className="rounded-full"
              />
            </div>
          )}
        </div>
        <div className="p-4">
          <h3 className="font-medium text-sm line-clamp-2" title={skin.name}>
            {skin.name}
          </h3>
          <p className="text-sm font-bold text-slate-700 mt-2">
            {formattedPrice} VP
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
