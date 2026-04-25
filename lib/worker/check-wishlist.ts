/**
 * Wishlist Check Worker
 * Phase 3: Worker endpoint integration
 * Main worker logic that processes all users and sends notifications
 */

import { loadKeyFromEnv, decryptTokens } from "@/lib/crypto/aes-gcm";
import { matchStoreAgainstWishlist } from "@/lib/domain/wishlist";
import { dispatchWishlistMatch, type ResendLike } from "@/lib/email/dispatch";
import type { UserTokensRepo } from "@/lib/supabase/user-tokens-repo";
import type { WishlistRepo } from "@/lib/supabase/wishlist-repo";
import type { NotificationsRepo } from "@/lib/supabase/notifications-repo";
import { getKstRotationDate } from "@/lib/supabase/notifications-repo";
import type { Catalog } from "@/lib/valorant-api/catalog";
import type { StorefrontClient } from "@/lib/riot/storefront-server";
import type { UserTokensRow } from "@/lib/supabase/types";
import { logger } from "@/lib/logger";

/**
 * Worker execution result
 */
export interface WorkerResult {
  processed: number;
  notified: number;
  errors: number;
}

/**
 * Worker dependencies (for dependency injection)
 */
export interface WorkerDeps {
  userTokensRepo: UserTokensRepo;
  // Worker 는 listFor 만 사용 — Plan 0016 의 풀 CRUD 를 강제하지 않도록 narrow.
  wishlistRepo: Pick<WishlistRepo, "listFor">;
  notificationsRepo: NotificationsRepo;
  storefrontClient: StorefrontClient;
  catalog: Catalog;
  resend: ResendLike;
  now?: Date;
}

/**
 * Run the wishlist check worker
 *
 * Process all active users:
 * 1. Fetch wishlist (skip if empty)
 * 2. Decrypt tokens
 * 3. Fetch storefront
 * 4. Match skins
 * 5. Filter unsent notifications
 * 6. Lookup metadata
 * 7. Send email
 * 8. Record sent notifications
 *
 * Errors are isolated per user (one user's failure doesn't stop others)
 */
export async function runWorker(deps: WorkerDeps): Promise<WorkerResult> {
  const result: WorkerResult = {
    processed: 0,
    notified: 0,
    errors: 0,
  };

  const now = deps.now || new Date();
  const rotationDate = getKstRotationDate(now);

  // Load encryption key once
  let key: CryptoKey | null = null;
  try {
    key = await loadKeyFromEnv();
  } catch (error) {
    logger.error("worker failed to load encryption key", { error: error instanceof Error ? error.message : String(error) });
    throw new Error("Worker cannot start: TOKEN_ENC_KEY not configured");
  }

  // Get all active users
  const users = await deps.userTokensRepo.listActive();
  logger.info("worker processing active users", { count: users.length });

  for (const user of users) {
    result.processed++;

    try {
      const notified = await processUser(deps, user, rotationDate, key);
      if (notified) {
        result.notified++;
      }
    } catch (error) {
      result.errors++;
      // Check if it's a StorefrontApiError (works even with mocked modules)
      if (
        error &&
        typeof error === "object" &&
        "name" in error &&
        error.name === "StorefrontApiError" &&
        "isAuthError" in error
      ) {
        if (error.isAuthError === true) {
          // Mark user for re-auth
          await deps.userTokensRepo.markNeedsReauth(user.user_id);
          logger.warn("worker user needs re-auth", { userId: user.user_id });
        } else {
          logger.error("worker user storefront error", {
            userId: user.user_id,
            message: (error as { message?: string }).message,
          });
        }
      } else {
        logger.error("worker user error", { userId: user.user_id, error });
      }
    }
  }

  logger.info("worker complete", {
    processed: result.processed,
    notified: result.notified,
    errors: result.errors,
  });
  return result;
}

/**
 * Process a single user
 * Returns true if user was notified (email sent), false otherwise
 */
async function processUser(
  deps: WorkerDeps,
  user: UserTokensRow,
  rotationDate: Date,
  key: CryptoKey
): Promise<boolean> {
  const userId = user.user_id;

  // 1. Get wishlist (skip if empty)
  const wishlist = await deps.wishlistRepo.listFor(userId);
  if (wishlist.length === 0) {
    logger.debug("worker user empty wishlist skipping", { userId });
    return false;
  }

  // 2. Decrypt tokens
  const { accessToken, entitlementsJwt } = await decryptTokens(
    Buffer.from(user.access_token_enc).toString("base64"),
    Buffer.from(user.refresh_token_enc).toString("base64"),
    Buffer.from(user.entitlements_jwt_enc).toString("base64"),
    key
  );

  // 3. Fetch storefront
  const storefront = await deps.storefrontClient.fetchStore({
    puuid: user.puuid,
    accessToken,
    entitlementsJwt,
  });

  // 4. Match skins
  const matchedUuids = matchStoreAgainstWishlist(storefront.skinUuids, wishlist);
  if (matchedUuids.length === 0) {
    logger.debug("worker user no matches", { userId });
    return false;
  }

  // 5. Filter unsent notifications
  const unsentUuids = await deps.notificationsRepo.filterUnsent(
    userId,
    matchedUuids,
    rotationDate
  );
  if (unsentUuids.length === 0) {
    logger.debug("worker user all matches already sent", { userId });
    return false;
  }

  // 6. Lookup metadata
  const catalogMap = await deps.catalog.lookupMany(unsentUuids);
  const matchedSkins = unsentUuids
    .map((uuid) => catalogMap.get(uuid))
    .filter((s): s is Exclude<typeof s, undefined> => s !== undefined);

  if (matchedSkins.length === 0) {
    logger.debug("worker user no skins found in catalog", { userId });
    return false;
  }

  // 7. Get user email (from auth.users via service role)
  // For now, we'll use a placeholder - the actual implementation would query auth.users
  const userEmail = `${userId}@example.com`; // TODO: Get from auth.users

  // 8. Send email
  await dispatchWishlistMatch(deps.resend, {
    to: userEmail,
    matches: matchedSkins,
  });

  // 9. Record sent notifications (only after successful email)
  await deps.notificationsRepo.insert(userId, unsentUuids, rotationDate);

  logger.info("worker user notified", { userId, count: matchedSkins.length });
  return true;
}
