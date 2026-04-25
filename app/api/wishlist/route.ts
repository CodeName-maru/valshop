/**
 * Wishlist Route Handler — collection
 *
 * GET  /api/wishlist        → { skins: string[] }
 * POST /api/wishlist        → { ok: true } (멱등)
 *
 * 에러 코드:
 *   401 unauthorized | 400 bad_request | 404 skin_not_found
 *   422 wishlist_limit_exceeded | 429 rate_limited
 *   503 wishlist_unavailable | 500 internal_error
 *
 * 본인성 격리: session.puuid → user_tokens.user_id 명시적 필터 (Plan 0016)
 */

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session/guard";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { createWishlistRepo } from "@/lib/supabase/wishlist-repo";
import { resolveUserIdFromSession } from "@/lib/wishlist/resolve-user";
import { tryConsume } from "@/lib/wishlist/rate-limit";
import { WishlistLimitExceededError } from "@/lib/domain/wishlist";
import { getSkinCatalog } from "@/lib/valorant-api/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function err(code: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: code, ...(extra ?? {}) }, { status });
}

export async function GET(_req: NextRequest): Promise<NextResponse> {
  const session = await getSession();
  if (!session) return err("unauthorized", 401);

  let supabase;
  try {
    supabase = createServiceRoleClient();
  } catch {
    return err("wishlist_unavailable", 503);
  }

  let userId: string | null;
  try {
    userId = await resolveUserIdFromSession(session, supabase);
  } catch {
    return err("wishlist_unavailable", 503);
  }
  if (!userId) return err("unauthorized", 401);

  const repo = createWishlistRepo(supabase);
  try {
    const skins = await repo.listFor(userId);
    return NextResponse.json({ skins });
  } catch {
    return err("wishlist_unavailable", 503);
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await getSession();
  if (!session) return err("unauthorized", 401);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return err("bad_request", 400);
  }
  const rawSkinId =
    body && typeof body === "object"
      ? (body as { skinId?: unknown }).skinId
      : undefined;
  const skinId = typeof rawSkinId === "string" ? rawSkinId.trim() : "";
  if (!skinId) return err("bad_request", 400);

  let supabase;
  try {
    supabase = createServiceRoleClient();
  } catch {
    return err("wishlist_unavailable", 503);
  }

  let userId: string | null;
  try {
    userId = await resolveUserIdFromSession(session, supabase);
  } catch {
    return err("wishlist_unavailable", 503);
  }
  if (!userId) return err("unauthorized", 401);

  if (!tryConsume(userId, "write")) {
    return err("rate_limited", 429);
  }

  // 카탈로그 검증 — 임의 skinId 로 풀린 위시리스트 방지
  try {
    const catalog = await getSkinCatalog();
    if (!catalog.has(skinId)) {
      return err("skin_not_found", 404);
    }
  } catch {
    // 카탈로그 fetch 실패 시 503 으로 폴백
    return err("wishlist_unavailable", 503);
  }

  const repo = createWishlistRepo(supabase);
  try {
    await repo.add(userId, skinId);
  } catch (e) {
    if (e instanceof WishlistLimitExceededError) {
      return err("wishlist_limit_exceeded", 422);
    }
    return err("wishlist_unavailable", 503);
  }

  return NextResponse.json({ ok: true });
}
