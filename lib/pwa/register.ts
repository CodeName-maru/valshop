/**
 * Service Worker 등록
 *
 * 'serviceWorker' in navigator 가드로 미지원 환경에서 silent fail
 */

export function registerServiceWorker(): void {
  if (typeof window === "undefined") return;
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then((registration) => {
        console.log("SW registered:", registration.scope);
      })
      .catch((error) => {
        console.error("SW registration failed:", error);
      });
  }
  // 미지원 환경에서 silent fail (요구사항)
}

/**
 * Service Worker 업데이트 대기 중 여부 확인
 */
export function isUpdateAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    if (!("serviceWorker" in navigator)) {
      resolve(false);
      return;
    }

    navigator.serviceWorker.ready.then((registration) => {
      if (!registration.waiting) {
        resolve(false);
        return;
      }
      resolve(true);
    });
  });
}
