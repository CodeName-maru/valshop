/**
 * API Route: /api/cron/check-wishlist
 * Vercel Cron endpoint for wishlist checking
 *
 * Triggered hourly via Vercel Cron (schedule: "0 * * * *")
 * Protected by CRON_SECRET environment variable
 */

import { NextRequest, NextResponse } from "next/server";
import { runWorker } from "@/lib/worker/check-wishlist";
import { createUserTokensRepo } from "@/lib/supabase/user-tokens-repo";
import { createWishlistRepo } from "@/lib/supabase/wishlist-repo";
import { createNotificationsRepo } from "@/lib/supabase/notifications-repo";
import { createStorefrontClient } from "@/lib/riot/storefront-server";
import { createCatalog } from "@/lib/valorant-api/catalog";

// Runtime configuration
export const runtime = "nodejs";
export const maxDuration = 60; // Vercel Hobby limit

/**
 * GET /api/cron/check-wishlist
 * Cron endpoint for checking wishlist matches
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  // 1. Verify CRON_SECRET
  const authHeader = request.headers.get("authorization");
  const expectedAuth = `Bearer ${process.env.CRON_SECRET}`;

  if (!process.env.CRON_SECRET || authHeader !== expectedAuth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Check if Resend is configured
  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json({ error: "RESEND_API_KEY not configured" }, { status: 500 });
  }

  // 3. Check if Supabase is configured
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  try {
    // 4. Create Supabase client (service role)
    // Note: Using dynamic import to avoid issues with client-only code
    const { createClient } = await import("@supabase/supabase-js");
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    // 5. Create Resend client
    const { Resend } = await import("resend");
    const resendClient = new Resend(process.env.RESEND_API_KEY);

    // 6. Create Resend adapter
    const resend = {
      emails: {
        send: async (params: { to: string | string[]; subject: string; html: string; text?: string }): Promise<{ id: string }> => {
          const result = await resendClient.emails.send(params as any);
          return { id: (result as any).id || "sent" };
        },
      },
    };

    // 7. Run worker
    const result = await runWorker({
      userTokensRepo: createUserTokensRepo(supabase),
      wishlistRepo: createWishlistRepo(supabase),
      notificationsRepo: createNotificationsRepo(supabase),
      storefrontClient: createStorefrontClient(),
      catalog: createCatalog(),
      resend,
    });

    return NextResponse.json({
      success: true,
      ...result,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[cron] Worker error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
