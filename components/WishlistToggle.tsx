"use client";

/**
 * WishlistToggle — 위시리스트 토글 (낙관적 UI)
 * Plan 0016 Phase 5
 *
 * - 클릭 시 즉시 로컬 state 반영 → 실패 시 rollback + 에러 메시지
 * - 422 → "위시리스트가 최대치(1000개) 에 도달했습니다"
 * - 503 → "잠시 후 다시 시도해 주세요"
 */

import { useState, useTransition } from "react";

interface WishlistToggleProps {
  skinUuid: string;
  initialInWishlist: boolean;
  onChange?: (next: boolean) => void;
  onError?: (message: string) => void;
}

export function WishlistToggle({
  skinUuid,
  initialInWishlist,
  onChange,
  onError,
}: WishlistToggleProps) {
  const [inWishlist, setInWishlist] = useState(initialInWishlist);
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (busy) return;
    const next = !inWishlist;
    // 낙관적 반영
    setInWishlist(next);
    onChange?.(next);
    setBusy(true);

    try {
      const res = next
        ? await fetch("/api/wishlist", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ skinId: skinUuid }),
          })
        : await fetch(`/api/wishlist/${encodeURIComponent(skinUuid)}`, {
            method: "DELETE",
          });

      if (!res.ok) {
        // rollback
        setInWishlist(!next);
        onChange?.(!next);
        let message = "잠시 후 다시 시도해 주세요";
        if (res.status === 422) {
          message = "위시리스트가 최대치(1000개) 에 도달했습니다";
        } else if (res.status === 401) {
          window.location.assign("/login");
          return;
        } else if (res.status === 429) {
          message = "잠시 후 다시 시도해 주세요 (요청이 너무 많습니다)";
        }
        onError?.(message);
      }
    } catch {
      setInWishlist(!next);
      onChange?.(!next);
      onError?.("네트워크 오류가 발생했습니다");
    } finally {
      setBusy(false);
    }
    // useTransition 사용처
    void pending;
    void startTransition;
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={inWishlist}
      aria-label={inWishlist ? "위시리스트에서 제거" : "위시리스트에 추가"}
      data-testid={`wishlist-toggle-${skinUuid}`}
      className={`inline-flex h-9 w-9 items-center justify-center rounded-full border ${
        inWishlist
          ? "border-rose-500 bg-rose-50 text-rose-600"
          : "border-slate-300 bg-white text-slate-500"
      }`}
    >
      {inWishlist ? "♥" : "♡"}
    </button>
  );
}
