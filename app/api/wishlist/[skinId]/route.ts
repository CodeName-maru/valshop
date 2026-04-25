/**
 * Wishlist Route Handler — item
 *
 * DELETE /api/wishlist/[skinId] → 204 (멱등)
 */

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session/guard";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { createWishlistRepo } from "@/lib/supabase/wishlist-repo";
import { resolveUserIdFromSession } from "@/lib/wishlist/resolve-user";
import { tryConsume } from "@/lib/wishlist/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function err(code: string, status: number) {
  return NextResponse.json({ error: code }, { status });
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ skinId: string }> }
): Promise<NextResponse> {
  const session = await getSession();
  if (!session) return err("unauthorized", 401);

  const { skinId } = await ctx.params;
  if (!skinId || typeof skinId !== "string") return err("bad_request", 400);

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

  const repo = createWishlistRepo(supabase);
  try {
    await repo.remove(userId, skinId);
  } catch {
    return err("wishlist_unavailable", 503);
  }

  return new NextResponse(null, { status: 204 });
}
