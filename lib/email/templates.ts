/**
 * Email Templates for Wishlist Notifications
 * Phase 2: Email dispatcher (pure layer)
 */

import type { MatchedSkin } from "@/lib/domain/wishlist";

/**
 * Build wishlist match email content
 *
 * @param matches - Array of matched skins with metadata
 * @returns Email content with subject, html, and text versions
 */
export function buildWishlistMatchEmail(matches: MatchedSkin[]): {
  subject: string;
  html: string;
  text: string;
} {
  if (matches.length === 0) {
    throw new Error("Cannot build email with zero matches");
  }

  // Build subject line
  const firstMatch = matches[0]!;
  let subject: string;
  if (matches.length === 1) {
    subject = `🎯 "${firstMatch.name}"이 상점에 있어요!`;
  } else {
    subject = `🎯 ${matches.length}개 위시리스트 스킨이 상점에 도착했어요!`;
  }

  // Build HTML content
  const skinsHtml = matches
    .map(
      (skin) => `
    <div style="border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin-bottom: 12px; background: #f9fafb;">
      <div style="display: flex; align-items: center; gap: 16px;">
        <img src="${skin.iconUrl}" alt="${skin.name}" style="width: 80px; height: 80px; object-fit: cover; border-radius: 4px;" />
        <div style="flex: 1;">
          <h3 style="margin: 0 0 8px 0; font-size: 18px; color: #111827;">${skin.name}</h3>
          <p style="margin: 0; font-size: 16px; color: #059669; font-weight: 600;">
            ${skin.priceVp.toLocaleString()} VP
          </p>
        </div>
      </div>
    </div>
  `
    )
    .join("");

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>위시리스트 알림</title>
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #374151; background: #f3f4f6; padding: 20px; margin: 0;">
        <div style="max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
          <!-- Header -->
          <div style="background: linear-gradient(135deg, #ff4655 0%, #ff6b6b 100%); padding: 32px 24px; text-align: center;">
            <h1 style="margin: 0; color: white; font-size: 28px; font-weight: 700;">VAL-Shop</h1>
            <p style="margin: 8px 0 0 0; color: rgba(255,255,255,0.9); font-size: 16px;">위시리스트 알림</p>
          </div>

          <!-- Content -->
          <div style="padding: 32px 24px;">
            <h2 style="margin: 0 0 16px 0; font-size: 24px; color: #111827;">
              ${matches.length === 1 ? "찜하신 스킨이 도착했어요!" : "여러 스킨이 도착했어요!"}
            </h2>
            <p style="margin: 0 0 24px 0; color: #6b7280;">
              오늘의 상점 로테이션에 위시리스트에 담은 스킨${
                matches.length > 1 ? "들" : ""
              }이 포함되어 있어요.
            </p>

            ${skinsHtml}

            <div style="text-align: center; margin-top: 32px;">
              <a href="https://valshop.vercel.app/dashboard" style="display: inline-block; background: #ff4655; color: white; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 16px;">
                상점 확인하러 가기
              </a>
            </div>
          </div>

          <!-- Footer -->
          <div style="background: #f9fafb; padding: 24px; text-align: center; border-top: 1px solid #e5e7eb;">
            <p style="margin: 0 0 8px 0; font-size: 12px; color: #9ca3af;">
              이 이메일은 VAL-Shop 위시리스트 알림 서비스에 의해 자으로 발송되었습니다.
            </p>
            <p style="margin: 0; font-size: 12px; color: #9ca3af;">
              <strong>fan-made project</strong> — Riot Games와 제휴하지 않은 비공식 프로젝트입니다.
            </p>
            <p style="margin: 8px 0 0 0; font-size: 11px; color: #9ca3af;">
              <a href="https://valshop.vercel.app/privacy" style="color: #9ca3af; text-decoration: underline;">개인정보처리방침</a>
              {' · '}
              구독을 원하지 않으시면 <a href="https://valshop.vercel.app/wishlist" style="color: #9ca3af; text-decoration: underline;">위시리스트를 비워주세요</a>
            </p>
          </div>
        </div>
      </body>
    </html>
  `;

  // Build plain text version
  const textLines = [
    "VAL-Shop - 위시리스트 알림",
    "=" .repeat(40),
    "",
    matches.length === 1
      ? "찜하신 스킨이 도착했어요!"
      : "여러 스킨이 도착했어요!",
    "",
    "오늘의 상점 로테이션에 위시리스트에 담은 스킨이 포함되어 있어요.",
    "",
    ...matches.map(
      (skin) =>
        `- ${skin.name} (${skin.priceVp.toLocaleString()} VP)\n  https://valshop.vercel.app/skin/${skin.uuid}`
    ),
    "",
    "상점 확인하러 가기: https://valshop.vercel.app/dashboard",
    "",
    "-".repeat(40),
    "이 이메일은 VAL-Shop 위시리스트 알림 서비스에 의해 자동으로 발송되었습니다.",
    "fan-made project — Riot Games와 제휴하지 않은 비공식 프로젝트입니다.",
    "개인정보처리방침: https://valshop.vercel.app/privacy",
  ];

  const text = textLines.join("\n");

  return { subject, html, text };
}
