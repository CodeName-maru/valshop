/**
 * Plan 0020 Phase 3: lib/session/reauth.ts 테스트
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { RiotFetcher } from "@/lib/riot/fetcher";

// Mock auth-client at top level
vi.mock("@/lib/riot/auth-client", () => ({
  reauthWithSsid: vi.fn(),
  exchangeEntitlements: vi.fn(),
}));

describe("Plan 0020 Phase 3: reauth.ts", () => {
  const mockFetcher: RiotFetcher = {
    fetch: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("3-1: given_validSsid_whenReauthAccess_thenReturnsNewAccessAndEntitlements", async () => {
    const { reauthWithSsid, exchangeEntitlements } = await import("@/lib/riot/auth-client");
    const { reauthAccess } = await import("@/lib/session/reauth");

    vi.mocked(reauthWithSsid).mockResolvedValue({
      kind: "ok",
      accessToken: "new-access-token",
      expiresIn: 3600,
    });
    vi.mocked(exchangeEntitlements).mockResolvedValue("new-entitlements-jwt");

    const result = await reauthAccess("valid-ssid", "tdid123", "kr", mockFetcher);

    expect(result).toEqual({
      kind: "ok",
      accessToken: "new-access-token",
      entitlementsJwt: "new-entitlements-jwt",
      accessExpiresAt: expect.any(Number),
    });
    expect(result.kind === "ok" && result.accessExpiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000) + 3500);
  });

  it("3-2: given_invalidSsid_whenReauthAccess_thenReturnsExpired", async () => {
    const { reauthWithSsid } = await import("@/lib/riot/auth-client");
    const { reauthAccess } = await import("@/lib/session/reauth");

    vi.mocked(reauthWithSsid).mockResolvedValue({ kind: "expired" });

    const result = await reauthAccess("invalid-ssid", null, "kr", mockFetcher);

    expect(result).toEqual({ kind: "expired" });
  });

  it("3-3: given_riot5xx_whenReauthAccess_thenReturnsUpstream", async () => {
    const { reauthWithSsid } = await import("@/lib/riot/auth-client");
    const { reauthAccess } = await import("@/lib/session/reauth");

    vi.mocked(reauthWithSsid).mockResolvedValue({ kind: "upstream" });

    const result = await reauthAccess("ssid", null, "kr", mockFetcher);

    expect(result).toEqual({ kind: "upstream" });
  });

  it("3-4: given_accessOkButEntitlementsFails_whenReauthAccess_thenReturnsUpstream", async () => {
    const { reauthWithSsid, exchangeEntitlements } = await import("@/lib/riot/auth-client");
    const { reauthAccess } = await import("@/lib/session/reauth");

    vi.mocked(reauthWithSsid).mockResolvedValue({
      kind: "ok",
      accessToken: "access",
      expiresIn: 3600,
    });
    vi.mocked(exchangeEntitlements).mockRejectedValue(new Error("Entitlements failed"));

    const result = await reauthAccess("ssid", null, "kr", mockFetcher);

    // entitlements 실패 → upstream 정규화
    expect(result).toEqual({ kind: "upstream" });
  });

  it("3-5: given_slowRiot_whenReauthAccess_thenAbortsAt3s", async () => {
    const { reauthWithSsid } = await import("@/lib/riot/auth-client");
    const { reauthAccess } = await import("@/lib/session/reauth");

    // reauthWithSsid가 내부적으로 3s timeout을 가지므로
    // timeout이 발생하면 upstream을 반환해야 함
    vi.mocked(reauthWithSsid).mockRejectedValue(new Error("AbortError"));

    const result = await reauthAccess("ssid", null, "kr", mockFetcher);

    // AbortError → upstream 정규화
    expect(result).toEqual({ kind: "upstream" });
  });
});
