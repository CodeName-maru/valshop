"use client";

import { useState, useEffect } from "react";
import { Button } from "./ui/button";

/**
 * PWA 설치 배너 컴포넌트
 *
 * - beforeinstallprompt 이벤트 가로채기
 * - 3회 dismiss 시 14일간 숨김 (localStorage)
 * - 대시보드 상단에 노출
 */
export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<Event | null>(null);
  const [dismissedUntil, setDismissedUntil] = useState<number | null>(null);

  useEffect(() => {
    // localStorage에서 dismissed 상태 복원
    const stored = localStorage.getItem("pwa:dismissed");
    if (stored) {
      const { until } = JSON.parse(stored);
      if (until > Date.now()) {
        setDismissedUntil(until);
      }
    }

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };

    window.addEventListener("beforeinstallprompt", handler);
    return () => { window.removeEventListener("beforeinstallprompt", handler); };
  }, []);

  if (!deferredPrompt || (dismissedUntil && dismissedUntil > Date.now())) {
    return null;
  }

  const handleInstall = async () => {
    const promptEvent = deferredPrompt as any;
    promptEvent.prompt();

    const { outcome } = await promptEvent.userChoice;
    if (outcome === "accepted") {
      setDeferredPrompt(null);
    }
  };

  const handleDismiss = () => {
    const stored = localStorage.getItem("pwa:dismissed");
    let count = 0;
    if (stored) {
      const parsed = JSON.parse(stored);
      count = parsed.count;
    }

    const newCount = count + 1;
    const until = Date.now() + 14 * 24 * 60 * 60 * 1000; // 14일

    localStorage.setItem(
      "pwa:dismissed",
      JSON.stringify({ count: newCount, until })
    );

    setDeferredPrompt(null);
  };

  return (
    <div className="bg-primary/10 border-b border-primary/20 px-4 py-2">
      <div className="container mx-auto flex items-center justify-between">
        <span className="text-sm">앱으로 설치하여 더 빠르게 이용하세요</span>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={handleDismiss} className="h-8 px-3 text-xs">
            나중에
          </Button>
          <Button onClick={handleInstall} className="h-8 px-3 text-xs">
            앱으로 설치
          </Button>
        </div>
      </div>
    </div>
  );
}
