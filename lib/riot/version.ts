/**
 * Riot Client Version Resolver
 * valorant-api.com/v1/version 에서 최신 클라이언트 버전을 조회
 * ISR 1시간 캐시
 */

/**
 * 최신 Riot Client Version 조회
 * @returns 버전 문자열 (예: "release-08.11-shipping-6-3154137")
 */
export async function getClientVersion(): Promise<string> {
  const response = await fetch("https://valorant-api.com/v1/version", {
    next: { revalidate: 3600 }, // 1 hour
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch client version: ${String(response.status)}`);
  }

  const json = await response.json();
  return json.data.riotClientVersion as string;
}
