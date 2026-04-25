/**
 * Plan 0014 Phase 1: bytea normalization helper tests
 */

import { describe, it, expect } from "vitest";
import { parseBytea, encodeBytea, BytEaParseError } from "@/lib/supabase/bytea";

describe("parseBytea", () => {
  it("Test 1-1: PostgREST \\x hex string → bytes", () => {
    const out = parseBytea("\\x48656c6c6f");
    expect(out).toBeInstanceOf(Uint8Array);
    expect(Array.from(out)).toEqual([0x48, 0x65, 0x6c, 0x6c, 0x6f]);
  });

  it("Test 1-2: base64 string → bytes", () => {
    const out = parseBytea("SGVsbG8=");
    expect(Array.from(out)).toEqual([0x48, 0x65, 0x6c, 0x6c, 0x6f]);
  });

  it("Test 1-3: Uint8Array passthrough", () => {
    const input = new Uint8Array([0xde, 0xad]);
    const out = parseBytea(input);
    expect(Array.from(out)).toEqual([0xde, 0xad]);
  });

  it("Test 1-3b: Buffer passthrough", () => {
    const input = Buffer.from([0xbe, 0xef]);
    const out = parseBytea(input);
    expect(Array.from(out)).toEqual([0xbe, 0xef]);
  });

  it("Test 1-4: JSON Buffer shape → bytes", () => {
    const out = parseBytea({ type: "Buffer", data: [0x01, 0x02] });
    expect(Array.from(out)).toEqual([0x01, 0x02]);
  });

  it("Test 1-5a: invalid hex after prefix (non-hex chars) → throws", () => {
    expect(() => parseBytea("\\xZZ")).toThrowError(BytEaParseError);
    try {
      parseBytea("\\xZZ");
    } catch (e) {
      expect((e as Error).message).toMatch(/invalid hex/);
    }
  });

  it("Test 1-5b: invalid hex after prefix (odd length) → throws", () => {
    expect(() => parseBytea("\\xabc")).toThrowError(BytEaParseError);
  });

  it("Test 1-6: numeric input → throws", () => {
    expect(() => parseBytea(12345)).toThrowError(BytEaParseError);
  });

  it("Test 1-7: error message omits ciphertext content (≤120 chars, prefix only)", () => {
    const big = "\\x" + "ZZ".repeat(200); // 400 invalid hex chars
    try {
      parseBytea(big, "access_token_enc");
      throw new Error("should have thrown");
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg.length).toBeLessThanOrEqual(120);
      // prefix shows only first 8 chars of input
      expect(msg).toContain("\\xZZZZZZ");
      // body of input must NOT leak
      expect(msg).not.toContain("ZZ".repeat(20));
      expect(msg).toContain("access_token_enc");
    }
  });

  it("Test 1-8 (encodeBytea): bytes → \\x<hex>", () => {
    expect(encodeBytea(new Uint8Array([0x48, 0x65]))).toBe("\\x4865");
  });

  it("Test 1-8b (encodeBytea): empty → \\x", () => {
    expect(encodeBytea(new Uint8Array(0))).toBe("\\x");
  });
});
