/**
 * Test 1-1: UserTokensRow 타입 확장 검증
 * Plan: docs/plan/0018_AUTH_DB_SCHEMA_MIGRATION_PLAN.md L156-187
 */

import { describe, it, expect } from "vitest";

// 타입만 import하므로 런타임 의존 없음
import type { UserTokensRow, UpsertTokensInput } from "@/lib/supabase/types";

describe("Feature: UserTokensRow 타입", () => {
  it("givenRowType_whenAssignSessionFields_thenTypeChecks", () => {
    const row: UserTokensRow = {
      user_id: "u",
      puuid: "p",
      session_id: "sid",
      session_expires_at: new Date(),
      ssid_enc: "base64",
      tdid_enc: null,
      access_token_enc: new Uint8Array(),
      refresh_token_enc: new Uint8Array(),
      entitlements_jwt_enc: new Uint8Array(),
      expires_at: new Date(),
      needs_reauth: false,
      created_at: new Date(),
      updated_at: new Date(),
    };
    expect(row.session_id).toBe("sid");
    expect(row.ssid_enc).toBe("base64");
    expect(row.tdid_enc).toBeNull();
  });

  it("givenUpsertTokensInput_whenAssignRequired_thenTypeChecks", () => {
    const input: UpsertTokensInput = {
      puuid: "p",
      sessionId: "s",
      sessionExpiresAt: new Date(),
      ssidEnc: "x",
      tdidEnc: null,
      accessTokenEnc: new Uint8Array(),
      entitlementsJwtEnc: new Uint8Array(),
      accessExpiresAt: new Date(),
    };
    expect(input.puuid).toBe("p");
    expect(input.sessionId).toBe("s");
    expect(input.tdidEnc).toBeNull();
  });

  it("givenUpsertTokensInput_withTdidEnc_whenTypeChecks", () => {
    const input: UpsertTokensInput = {
      puuid: "p",
      sessionId: "s",
      sessionExpiresAt: new Date(),
      ssidEnc: "x",
      tdidEnc: "trusted-device-base64",
      accessTokenEnc: new Uint8Array(),
      entitlementsJwtEnc: new Uint8Array(),
      accessExpiresAt: new Date(),
    };
    expect(input.tdidEnc).toBe("trusted-device-base64");
  });
});
