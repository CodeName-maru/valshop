"use client";

import { useEffect } from "react";
import { registerServiceWorker } from "@/lib/pwa/register";

/**
 * PWA 초기화 컴포넌트
 *
 * - Service Worker 등록
 * - layout.tsx에서 mount
 */
export function PWAInit() {
  useEffect(() => {
    registerServiceWorker();
  }, []);

  return null;
}
