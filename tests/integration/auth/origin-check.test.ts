/**
 * Plan 0021 Phase 5: Origin Check Tests
 *
 * spec § 6: CSRF 방어 + SameSite 이중 방어
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { withOrigin } from "@/lib/middleware/origin-check";
import { NextRequest } from "next/server";

describe("Origin Check Middleware", () => {
  const APP_ORIGIN = "https://valshop.vercel.app";

  beforeEach(() => {
    process.env.APP_ORIGIN = APP_ORIGIN;
  });

  afterEach(() => {
    delete process.env.APP_ORIGIN;
  });

  describe("withOrigin", () => {
    it("given일치Origin_whenWithOrigin_thenNull반환", () => {
      const req = new NextRequest(APP_ORIGIN, {
        headers: {
          "Origin": APP_ORIGIN,
        },
      });

      const result = withOrigin(req);
      expect(result).toBeNull();
    });

    it("given불일치Origin_whenWithOrigin_then403Response", () => {
      const req = new NextRequest(APP_ORIGIN, {
        headers: {
          "Origin": "https://evil.com",
        },
      });

      const result = withOrigin(req);
      expect(result).not.toBeNull();

      if (result) {
        expect(result.status).toBe(403);
      }
    });

    it("givenOrigin없음_whenWithOrigin_then403Response", () => {
      const req = new NextRequest(APP_ORIGIN, {
        // No Origin header
      });

      const result = withOrigin(req);
      expect(result).not.toBeNull();

      if (result) {
        expect(result.status).toBe(403);
      }
    });

    it("givenAPP_ORIGIN미설정_whenWithOrigin_then403_fail_closed", () => {
      delete process.env.APP_ORIGIN;

      const req = new NextRequest(APP_ORIGIN, {
        headers: {
          "Origin": APP_ORIGIN,
        },
      });

      const result = withOrigin(req);
      expect(result).not.toBeNull();

      if (result) {
        expect(result.status).toBe(403);
      }
    });
  });
});
