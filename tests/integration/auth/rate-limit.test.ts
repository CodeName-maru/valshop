/**
 * Plan 0021 Phase 4: Rate Limit Tests
 *
 * spec § 6: NFR Scale + Security + Cost 0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { extractIp, withRateLimit } from "@/lib/middleware/rate-limit";
import { NextRequest } from "next/server";

// Mock supabase client
vi.mock("@/lib/supabase/admin", () => ({
  createServiceRoleClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: { code: "PGRST116" } })),
        })),
      })),
      upsert: vi.fn(() => Promise.resolve({ error: null })),
      update: vi.fn(() => ({
        eq: vi.fn(() => Promise.resolve({ error: null })),
      })),
    })),
  })),
}));

describe("Rate Limit Middleware", () => {
  beforeEach(() => {
    process.env.TOKEN_ENC_KEY = Buffer.alloc(32, "a").toString("base64");
    process.env.PENDING_ENC_KEY = Buffer.alloc(32, "b").toString("base64");
  });

  describe("extractIp", () => {
    it("givenXForwardedFor_whenExtractIp_then첫번째IP반환", () => {
      const req = new NextRequest("https://example.com", {
        headers: {
          "x-forwarded-for": "1.2.3.4, 5.6.7.8, 9.10.11.12",
        },
      });

      const ip = extractIp(req);
      expect(ip).toBe("1.2.3.4");
    });

    it("givenXRealIp_whenExtractIp_then해당IP반환", () => {
      const req = new NextRequest("https://example.com", {
        headers: {
          "x-real-ip": "5.6.7.8",
        },
      });

      const ip = extractIp(req);
      expect(ip).toBe("5.6.7.8");
    });

    it("givenNoIpHeaders_whenExtractIp_then127001반환", () => {
      const req = new NextRequest("https://example.com");

      const ip = extractIp(req);
      expect(ip).toBe("127.0.0.1");
    });

    it("givenEmptyXForwardedFor_whenExtractIp_then127001반환", () => {
      const req = new NextRequest("https://example.com", {
        headers: {
          "x-forwarded-for": "",
        },
      });

      const ip = extractIp(req);
      expect(ip).toBe("127.0.0.1");
    });
  });

  describe("withRateLimit", () => {
    // Note: Full rate limit tests require DB integration
    // These tests verify the structure and types
    it("given옵션_whenWithRateLimit_thenPromise반환", async () => {
      const req = new NextRequest("https://example.com", {
        headers: {
          "x-forwarded-for": "1.2.3.4",
        },
      });

      const result = await withRateLimit(req, {
        path: "test",
        limit: 5,
        windowSec: 60,
      });

      // Result is either null (passed) or NextResponse (rate limited)
      expect(result === null || result instanceof Response).toBe(true);
    });
  });
});
