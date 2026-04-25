/**
 * Email Dispatcher for Wishlist Notifications
 * Phase 2: Email dispatcher (pure layer)
 */

import type { MatchedSkin } from "@/lib/domain/wishlist";
import { buildWishlistMatchEmail } from "./templates";

/**
 * Resend-like interface for port/adapter pattern
 * Allows test injection without depending directly on Resend SDK
 */
export interface ResendLike {
  emails: {
    send: (params: {
      to: string | string[];
      subject: string;
      html: string;
      text?: string;
    }) => Promise<{ id: string }>;
  };
}

/**
 * Dispatch wishlist match email to user
 *
 * @param resend - Resend-like client (port interface)
 * @param payload - Email recipient and matched skins
 * @returns Promise that resolves when email is sent
 * @throws Error if Resend API call fails
 */
export async function dispatchWishlistMatch(
  resend: ResendLike,
  payload: {
    to: string;
    matches: MatchedSkin[];
  }
): Promise<void> {
  const { to, matches } = payload;

  if (matches.length === 0) {
    throw new Error("Cannot dispatch email with zero matches");
  }

  const email = buildWishlistMatchEmail(matches);

  await resend.emails.send({
    to,
    subject: email.subject,
    html: email.html,
    text: email.text,
  });
}
