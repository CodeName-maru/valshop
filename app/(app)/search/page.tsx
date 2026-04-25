"use client";

/**
 * /search — 카탈로그 검색 + 위시리스트 토글 (Plan 0016 FR-7)
 */

import { useEffect, useMemo, useState, useDeferredValue } from "react";
import type { Skin } from "@/lib/domain/skin";
import { filterSkinsByQuery } from "@/lib/domain/wishlist";
import { SkinCard } from "@/components/SkinCard";
import { WishlistToggle } from "@/components/WishlistToggle";

export default function SearchPage() {
  const [catalog, setCatalog] = useState<Skin[]>([]);
  const [wishlist, setWishlist] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const deferred = useDeferredValue(query);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [cRes, wRes] = await Promise.all([
          fetch("/api/catalog"),
          fetch("/api/wishlist"),
        ]);
        if (wRes.status === 401) {
          window.location.assign("/login");
          return;
        }
        if (!cRes.ok) {
          setError("카탈로그를 불러오지 못했습니다");
          return;
        }
        const cBody = (await cRes.json()) as { skins?: Skin[] };
        const wBody = wRes.ok
          ? ((await wRes.json()) as { skins?: string[] })
          : { skins: [] };
        if (!alive) return;
        setCatalog(cBody.skins ?? []);
        setWishlist(new Set<string>(wBody.skins ?? []));
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

  const filtered = useMemo(
    () => filterSkinsByQuery(catalog, deferred),
    [catalog, deferred]
  );

  return (
    <div className="p-4">
      <h1 className="text-xl font-bold mb-4">스킨 검색</h1>
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="스킨 이름 검색"
        aria-label="스킨 이름 검색"
        data-testid="search-input"
        className="w-full mb-4 rounded border border-slate-300 px-3 py-2"
      />
      {toast && (
        <div role="status" data-testid="toast" className="mb-3 text-sm text-rose-600">
          {toast}
        </div>
      )}
      {loading && <p>로딩 중...</p>}
      {error && <p className="text-rose-600">{error}</p>}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4" data-testid="skin-grid">
        {filtered.map((skin) => (
          <SkinCard
            key={skin.uuid}
            skin={skin}
            action={
              <WishlistToggle
                skinUuid={skin.uuid}
                initialInWishlist={wishlist.has(skin.uuid)}
                onChange={(next) => {
                  setWishlist((prev) => {
                    const n = new Set(prev);
                    if (next) n.add(skin.uuid);
                    else n.delete(skin.uuid);
                    return n;
                  });
                }}
                onError={(m) => {
                  setToast(m);
                  setTimeout(() => setToast(null), 4000);
                }}
              />
            }
          />
        ))}
      </div>
    </div>
  );
}
