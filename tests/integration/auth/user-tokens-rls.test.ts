/**
 * Test 4-1 ~ 4-6: RLS 통합 테스트 (Security NFR 핵심)
 * Plan: docs/plan/0018_AUTH_DB_SCHEMA_MIGRATION_PLAN.md L370-421
 *
 * NOTE: 통합 테스트는 실제 Supabase 로컬 인스턴스가 필요합니다.
 * env 없으면 스킵합니다.
 */

import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { createUserTokensRepo } from "@/lib/supabase/user-tokens-repo";
import type { UpsertTokensInput } from "@/lib/supabase/types";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || "";
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || "";

describe("UserTokens RLS — Plan 0018 Security NFR", () => {
  const serviceRole = SUPABASE_URL && SUPABASE_SERVICE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    : null;
  const anonClient = SUPABASE_URL && SUPABASE_ANON_KEY
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

  function requireAnon() {
    if (!anonClient) throw new Error("anonClient not configured");
    return anonClient;
  }
  function requireService() {
    if (!serviceRole) throw new Error("serviceRole not configured");
    return serviceRole;
  }

  beforeAll(() => {
    if (!serviceRole || !anonClient) {
      console.warn("Supabase env not configured, skipping RLS tests");
    }
  });

  // Test 4-1: anon client — select 권한 거부
  it.skipIf(!anonClient)("givenAnonClient_whenSelectUserTokens_thenZeroRowsOrDenied", async () => {
    const { data, error } = await requireAnon()
      .from("user_tokens")
      .select("*");

    // 기본 deny: 빈 배열 또는 권한 거부 에러
    if (error) {
      expect(error.message).toMatch(/permission|policy|denied/i);
    } else {
      expect(data).toEqual([]);
    }
  });

  // Test 4-2: anon client — insert 거부
  it.skipIf(!anonClient)("givenAnonClient_whenInsertUserTokens_thenRejected", async () => {
    const { error } = await requireAnon()
      .from("user_tokens")
      .insert({
        puuid: "test-puuid",
        session_id: "test-session",
        session_expires_at: new Date().toISOString(),
        ssid_enc: "test",
      });

    expect(error).toBeDefined();
    expect(error?.message).toMatch(/permission|policy|denied/i);
  });

  // Test 4-3: anon — ssid_enc / tdid_enc 컬럼도 접근 불가
  it.skipIf(!anonClient)("givenAnonClient_whenSelectSsidEncColumn_thenDeniedOrEmpty", async () => {
    const { data, error } = await requireAnon()
      .from("user_tokens")
      .select("ssid_enc, tdid_enc");

    if (error) {
      expect(error.message).toMatch(/permission|policy|denied/i);
    } else {
      expect(data).toEqual([]);
    }
  });

  // Test 4-4: service_role 우회 검증
  it.skipIf(!serviceRole)("givenServiceRoleClient_whenSelectAll_thenRowsVisible", async () => {
    // service_role으로 row 생성
    const testPuuid = `test-rls-${Date.now()}`;
    const { error: insertError } = await requireService()
      .from("user_tokens")
      .insert({
        puuid: testPuuid,
        session_id: `session-${Date.now()}`,
        session_expires_at: new Date(Date.now() + 3600000).toISOString(),
        ssid_enc: "test-ssid",
        tdid_enc: null,
        access_token_enc: "\\x", // dummy bytea
        refresh_token_enc: "\\x",
        entitlements_jwt_enc: "\\x",
        expires_at: new Date(Date.now() + 3600000).toISOString(),
        needs_reauth: false,
      });

    expect(insertError).toBeNull();

    // service_role으로 select → rows 보임
    const { data, error: selectError } = await requireService()
      .from("user_tokens")
      .select("*")
      .eq("puuid", testPuuid);

    expect(selectError).toBeNull();
    expect(data?.length).toBeGreaterThan(0);

    // cleanup
    await requireService().from("user_tokens").delete().eq("puuid", testPuuid);
  });

  // Test 4-5: rate_limit_buckets anon 거부
  it.skipIf(!anonClient)("givenAnonClient_whenSelectRateLimitBuckets_thenDenied", async () => {
    const { data, error } = await requireAnon()
      .from("rate_limit_buckets")
      .select("*");

    if (error) {
      expect(error.message).toMatch(/permission|policy|denied/i);
    } else {
      expect(data).toEqual([]);
    }
  });

  // Test 4-6: repo 왕복 smoke (실 Supabase)
  it.skipIf(!serviceRole)("givenServiceRoleRepo_whenUpsertThenFindThenDelete_thenCycle", async () => {
    const repo = createUserTokensRepo(requireService());

    const testPuuid = `test-repo-${Date.now()}`;
    const testSessionId = `session-${Date.now()}`;

    const input: UpsertTokensInput = {
      puuid: testPuuid,
      sessionId: testSessionId,
      sessionExpiresAt: new Date(Date.now() + 3600000),
      ssidEnc: "test-ssid-encrypted",
      tdidEnc: null,
      accessTokenEnc: new Uint8Array([1, 2, 3]),
      entitlementsJwtEnc: new Uint8Array([4, 5, 6]),
      accessExpiresAt: new Date(Date.now() + 3600000),
    };

    // upsert
    const upsertResult = await repo.upsertTokens(input);
    expect(upsertResult.user_id).toBeDefined();

    // findBySessionId
    const found = await repo.findBySessionId(testSessionId);
    expect(found).not.toBeNull();
    expect(found?.puuid).toBe(testPuuid);
    expect(found?.session_id).toBe(testSessionId);

    // deleteBySessionId
    await repo.deleteBySessionId(testSessionId);

    // verify deleted
    const afterDelete = await repo.findBySessionId(testSessionId);
    expect(afterDelete).toBeNull();
  });
});
