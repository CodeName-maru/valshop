/**
 * 상점 갱신 카운트다운 시간 계산 순수 함수들
 * Plan 0004: 상점 갱신 카운트다운 타이머
 */

// KST (Korea Standard Time) offset from UTC: +9 hours
export const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

// One day in milliseconds
const DAY_MS = 86_400_000;

/**
 * Calculates the number of seconds until the next midnight KST.
 *
 * @param nowMs - Current timestamp in milliseconds (since Unix epoch)
 * @returns Number of seconds until next 00:00 KST (always >= 0)
 */
export function secondsUntilNextKstMidnight(nowMs: number): number {
  // Convert to KST time
  const nowKst = nowMs + KST_OFFSET_MS;

  // Calculate the next midnight in KST
  // floor to current day, then add one day
  const nextMidnightKst = Math.floor(nowKst / DAY_MS) * DAY_MS + DAY_MS;

  // Calculate remaining milliseconds, convert to seconds, and round up
  // Math.ceil ensures we show "1" second remaining even at 0.1s
  const remainingMs = nextMidnightKst - nowKst;
  const remainingSeconds = Math.ceil(remainingMs / 1000);

  // Ensure non-negative (shouldn't happen with above logic, but safety clamp)
  return Math.max(0, remainingSeconds);
}

/**
 * Formats total seconds into HH:MM:SS format.
 *
 * @param totalSeconds - Total seconds to format (can be negative, will be clamped to 0)
 * @returns Formatted string in "HH:MM:SS" format
 */
export function formatHms(totalSeconds: number): string {
  // Validate and clamp input
  if (!Number.isFinite(totalSeconds)) {
    return "00:00:00";
  }

  const seconds = Math.max(0, Math.floor(totalSeconds));

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  const pad2 = (n: number): string => n.toString().padStart(2, "0");

  return `${pad2(hours)}:${pad2(minutes)}:${pad2(secs)}`;
}
