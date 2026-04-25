"use client";

/**
 * ChromaSelector Component
 * FR-9: 스킨 색상 옵션 선택 UI
 * 클라이언트 컴포넌트로 useState로 선택 상태 관리
 */

import { Button } from "@/components/ui/button";
import type { Chroma } from "@/lib/domain/skin";

interface ChromaSelectorProps {
  chromas: Chroma[];
  onSelect: (index: number) => void;
  selectedIndex?: number;
}

/**
 * Render chroma selection buttons
 * If 1 or fewer chromas, returns null (hides selector)
 */
export function ChromaSelector({
  chromas,
  onSelect,
  selectedIndex = 0,
}: ChromaSelectorProps) {
  // Hide if 1 or fewer chromas
  if (chromas.length <= 1) {
    return null;
  }

  return (
    <div data-testid="chroma-selector" className="space-y-2">
      <p className="text-sm font-medium text-slate-700">색상 옵션</p>
      <div className="flex flex-wrap gap-2">
        {chromas.map((chroma, index) => (
          <Button
            key={chroma.uuid}
            variant={selectedIndex === index ? "default" : "outline"}
            aria-pressed={selectedIndex === index}
            onClick={() => { onSelect(index); }}
            className="text-sm"
          >
            {chroma.displayName}
          </Button>
        ))}
      </div>
    </div>
  );
}
