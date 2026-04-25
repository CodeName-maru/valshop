/**
 * URL Security Utilities
 * FR-9: 외부 비디오 링크 보안 검증
 */

/**
 * Allowed video hostnames whitelist
 */
const ALLOWED_VIDEO_HOSTNAMES = [
  "youtube.com",
  "www.youtube.com",
  "youtu.be",
  "media.valorant-api.com",
];

/**
 * Check if a URL is a safe external video URL
 * Security NFR: Only allow HTTPS URLs from whitelisted domains
 *
 * @param url - URL string to validate
 * @returns true if URL is safe, false otherwise
 */
export function isSafeExternalVideoUrl(
  url: string | null | undefined
): boolean {
  // Null/undefined checks
  if (url === null || url === undefined) {
    return false;
  }

  // Empty string check
  if (url.trim() === "") {
    return false;
  }

  try {
    const parsed = new URL(url);

    // Must be HTTPS
    if (parsed.protocol !== "https:") {
      return false;
    }

    // Hostname must be in whitelist
    if (!ALLOWED_VIDEO_HOSTNAMES.includes(parsed.hostname)) {
      return false;
    }

    return true;
  } catch {
    // URL parsing failed (invalid URL, javascript: protocol, etc.)
    return false;
  }
}
