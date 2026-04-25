/**
 * Test 2-4 ~ 2-5: Email Dispatcher
 * Phase 2: Email dispatcher (pure layer)
 */

import { describe, it, expect, vi } from "vitest";
import { dispatchWishlistMatch } from "@/lib/email/dispatch";
import type { MatchedSkin } from "@/lib/domain/wishlist";
import { buildWishlistMatchEmail } from "@/lib/email/templates";

describe("Feature: Email Dispatcher", () => {
  describe("Scenario: 이메일 디스패처 — Resend 호출 포맷", () => {
    it("given매칭스킨1개_when디스패치_then한통의이메일_제목에스킨이름_본문html", async () => {
      // Given: fake Resend client (인자로 주입)
      const calls: any[] = [];
      const fakeResend = {
        emails: {
          send: vi.fn().mockImplementation(async (p) => {
            calls.push(p);
            return { id: "test-id" };
          }),
        },
      };

      const match: MatchedSkin = {
        uuid: "test-uuid",
        name: "Reaver Vandal",
        priceVp: 1775,
        iconUrl: "https://example.com/icon.png",
      };

      // When
      await dispatchWishlistMatch(fakeResend, {
        to: "user@example.com",
        matches: [match],
      });

      // Then
      expect(calls).toHaveLength(1);
      expect(calls[0].to).toBe("user@example.com");
      expect(calls[0].subject).toContain("Reaver Vandal");
      expect(calls[0].html).toContain("Reaver Vandal");
      expect(calls[0].html).toContain("1,775"); // formatted with comma
      expect(calls[0].html).toContain("fan-made");
    });

    it("given매칭스킨2개_when디스패치_then한통의이메일_제목에N개표시", async () => {
      // Given
      const calls: any[] = [];
      const fakeResend = {
        emails: {
          send: vi.fn().mockImplementation(async (p) => {
            calls.push(p);
            return { id: "test-id" };
          }),
        },
      };

      const matches: MatchedSkin[] = [
        {
          uuid: "uuid-1",
          name: "Reaver Vandal",
          priceVp: 1775,
          iconUrl: "https://example.com/icon1.png",
        },
        {
          uuid: "uuid-2",
          name: "Prime Phantom",
          priceVp: 1775,
          iconUrl: "https://example.com/icon2.png",
        },
      ];

      // When
      await dispatchWishlistMatch(fakeResend, {
        to: "user@example.com",
        matches,
      });

      // Then
      expect(calls).toHaveLength(1);
      expect(calls[0].subject).toContain("2개");
      expect(calls[0].html).toContain("Reaver Vandal");
      expect(calls[0].html).toContain("Prime Phantom");
      expect(calls[0].html).toContain("fan-made");
    });

    it("given매칭0개_when디스패치_then예외", async () => {
      // Given
      const fakeResend = {
        emails: {
          send: vi.fn(),
        },
      };

      // When/Then
      await expect(
        dispatchWishlistMatch(fakeResend, {
          to: "user@example.com",
          matches: [],
        })
      ).rejects.toThrow("Cannot dispatch email with zero matches");
      expect(fakeResend.emails.send).not.toHaveBeenCalled();
    });
  });

  describe("Scenario: 디스패처 — Resend 실패 전파", () => {
    it("givenResend5xx_when디스패치_then예외전파_워커가catch", async () => {
      // Given
      const fakeResend = {
        emails: {
          send: vi.fn().mockRejectedValue(new Error("5xx Internal Server Error")),
        },
      };

      const match: MatchedSkin = {
        uuid: "test-uuid",
        name: "Reaver Vandal",
        priceVp: 1775,
        iconUrl: "https://example.com/icon.png",
      };

      // When/Then
      await expect(
        dispatchWishlistMatch(fakeResend, {
          to: "user@example.com",
          matches: [match],
        })
      ).rejects.toThrow("5xx Internal Server Error");
    });
  });

  describe("Feature: Email Templates", () => {
    it("given매칭스킨_when템플릿빌드_then제목_html_text_반환", () => {
      // Given
      const matches: MatchedSkin[] = [
        {
          uuid: "test-uuid",
          name: "Elderflame Vandal",
          priceVp: 2475,
          iconUrl: "https://example.com/icon.png",
        },
      ];

      // When
      const email = buildWishlistMatchEmail(matches);

      // Then
      expect(email.subject).toContain("Elderflame Vandal");
      expect(email.html).toContain("Elderflame Vandal");
      expect(email.html).toContain("2,475"); // formatted price
      expect(email.html).toContain("fan-made");
      expect(email.text).toContain("Elderflame Vandal");
      expect(email.text).toContain("fan-made");
    });

    it("given매칭0개_when템플릿빌드_then예외", () => {
      // When/Then
      expect(() => buildWishlistMatchEmail([])).toThrow(
        "Cannot build email with zero matches"
      );
    });
  });
});
