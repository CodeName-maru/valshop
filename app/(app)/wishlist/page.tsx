"use client";

/**
 * /wishlist — 내 위시리스트 (Plan 0016 FR-7)
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Skin } from "@/lib/domain/skin";
import { SkinCard } from "@/components/SkinCard";

export default function WishlistPage() {
  const [items, setItems] = useState<Skin[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true as boolean;
    (async () => {
      try {
        const wRes = await fetch("/api/wishlist");
        if (wRes.status === 401) {
          window.location.assign("/login");
          return;
        }
        if (!wRes.ok) {
          setError("위시리스트를 불러오지 못했습니다");
          return;
        }
        const { skins: ids } = (await wRes.json()) as { skins: string[] };
        const cRes = await fetch("/api/catalog");
        if (!cRes.ok) {
          setError("카탈로그를 불러오지 못했습니다");
          return;
        }
        const { skins: catalog } = (await cRes.json()) as { skins: Skin[] };
        const idSet = new Set(ids);
        const joined = catalog.filter((s) => idSet.has(s.uuid));
        if (alive) setItems(joined);
      } catch {
        if (alive) setError("네트워크 오류");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  async function remove(uuid: string) {
    const prev = items;
    setItems((p) => p.filter((s) => s.uuid !== uuid));
    const res = await fetch(`/api/wishlist/${encodeURIComponent(uuid)}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      // rollback
      setItems(prev);
      setError("삭제에 실패했습니다");
    }
  }

  if (loading) return <div className="p-4">로딩 중...</div>;
  if (error) return <div className="p-4 text-rose-600">{error}</div>;
  if (items.length === 0) {
    return (
      <div className="p-4" data-testid="wishlist-empty">
        <p>위시리스트가 비어 있습니다.</p>
        <Link href="/search" className="text-blue-600 underline">
          검색에서 스킨을 찜해보세요
        </Link>
      </div>
    );
  }

  return (
    <div className="p-4">
      <h1 className="text-xl font-bold mb-4">내 위시리스트</h1>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4" data-testid="wishlist-grid">
        {items.map((skin) => (
          <SkinCard
            key={skin.uuid}
            skin={skin}
            action={
              <button
                type="button"
                onClick={() => remove(skin.uuid)}
                aria-label="위시리스트에서 제거"
                data-testid={`wishlist-remove-${skin.uuid}`}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-600"
              >
                ✕
              </button>
            }
          />
        ))}
      </div>
    </div>
  );
}
