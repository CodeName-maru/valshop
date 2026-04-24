"use client";

/**
 * SkinDetailView Component
 * FR-9: 스킨 상세 뷰 메인 컴포넌트
 * 메인 이미지 + 크로마 선택 + 비디오 링크 + 레벨 이미지 리스트 조립
 */

import { useState } from "react";
import Image from "next/image";
import { ChromaSelector } from "./ChromaSelector";
import { VideoLink } from "./VideoLink";
import type { SkinDetail } from "@/lib/domain/skin";

interface SkinDetailViewProps {
  skin: SkinDetail;
}

/**
 * Main skin detail view component
 * Displays skin image with chroma selection, levels, and video link
 */
export function SkinDetailView({ skin }: SkinDetailViewProps) {
  const [selectedChromaIndex, setSelectedChromaIndex] = useState(0);

  // Use chroma fullRender if available, otherwise fall back to displayIcon
  const mainImageSrc =
    skin.chromas[selectedChromaIndex]?.fullRender || skin.displayIcon || "";

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Header */}
      <header className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900">
          {skin.displayName}
        </h1>
      </header>

      {/* Main Image */}
      <div className="mb-8">
        <Image
          data-testid="main-skin-image"
          src={mainImageSrc}
          alt={skin.displayName}
          width={600}
          height={400}
          className="rounded-lg shadow-lg"
          priority
          loading="eager"
        />
      </div>

      {/* Chroma Selector */}
      {skin.chromas.length > 1 && (
        <div className="mb-8">
          <ChromaSelector
            chromas={skin.chromas}
            onSelect={setSelectedChromaIndex}
            selectedIndex={selectedChromaIndex}
          />
        </div>
      )}

      {/* Video Link */}
      <div className="mb-8">
        <p className="text-sm font-medium text-slate-700 mb-2">관련 영상</p>
        <VideoLink url={skin.streamedVideo} />
      </div>

      {/* Level Images */}
      {skin.levels.length > 0 && (
        <div>
          <h2 className="text-xl font-semibold text-slate-900 mb-4">
            업그레이드 레벨
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {skin.levels.map((level, index) => (
              <div key={level.uuid} className="text-center">
                {level.displayIcon && (
                  <Image
                    data-testid={`level-image-${index}`}
                    src={level.displayIcon}
                    alt={level.displayName}
                    width={200}
                    height={150}
                    className="rounded-md shadow"
                    loading="lazy"
                  />
                )}
                <p className="mt-2 text-sm text-slate-600">
                  {level.displayName}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
