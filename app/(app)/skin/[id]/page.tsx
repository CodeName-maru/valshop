/**
 * Skin Detail Page
 * FR-9: 스킨 상세 뷰 (크로마/고화질/영상 링크)
 * RSC (React Server Component)로 초기 렌더 최적화
 */

import { notFound } from "next/navigation";
import { getSkinDetail } from "@/lib/valorant-api/catalog";
import { SkinDetailView } from "@/components/skin-detail/SkinDetailView";

interface SkinDetailPageProps {
  params: Promise<{
    id: string;
  }>;
}

/**
 * Skin detail page component
 * Fetches skin data server-side and renders the view
 */
export default async function SkinDetailPage({ params }: SkinDetailPageProps) {
  const { id } = await params;

  // Fetch skin detail from valorant-api
  const skin = await getSkinDetail(id);

  // 404 if skin not found
  if (!skin) {
    notFound();
  }

  return <SkinDetailView skin={skin} />;
}
