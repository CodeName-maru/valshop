/**
 * VideoLink Component
 * FR-9: 안전한 외부 비디오 링크 렌더링
 * Security NFR: 화이트리스트 검증 후 안전한 속성으로 렌더
 */

import { isSafeExternalVideoUrl } from "@/lib/security/url";

interface VideoLinkProps {
  url: string | null | undefined;
}

/**
 * Render a safe external video link
 * Only renders anchor tag if URL passes security validation
 */
export function VideoLink({ url }: VideoLinkProps) {
  if (!isSafeExternalVideoUrl(url)) {
    return (
      <span className="text-sm text-slate-500">
        인게임 영상 없음
      </span>
    );
  }

  return (
    <a
      href={url ?? undefined}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="inline-flex items-center text-sm text-blue-600 hover:text-blue-800 underline"
    >
      인게임 영상 보기
    </a>
  );
}
