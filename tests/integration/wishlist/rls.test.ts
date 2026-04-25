/**
 * Tests 3-2, 4-1, 4-2: Supabase 통합 (RLS 격리 + Scale)
 * Plan 0016 Phase 3, 4
 *
 * 활성화 조건: SUPABASE_TEST_URL + SUPABASE_TEST_SERVICE_ROLE_KEY + SUPABASE_TEST_ANON_KEY
 * 모두 set 일 때만 실행. 그 외 환경에서는 skip — critical-path 스위트 차단 회피.
 *
 * 로컬 실행:
 *   supabase start
 *   SUPABASE_TEST_URL=http://127.0.0.1:54321 \
 *   SUPABASE_TEST_SERVICE_ROLE_KEY=$(supabase status -o env | grep SERVICE_ROLE | cut -d= -f2) \
 *   SUPABASE_TEST_ANON_KEY=$(supabase status -o env | grep ANON_KEY | cut -d= -f2) \
 *   npm run test:integration -- wishlist/rls
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_TEST_URL;
const SERVICE_KEY = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_TEST_ANON_KEY;
const HAS_DB = !!URL && !!SERVICE_KEY && !!ANON_KEY;
const d = HAS_DB ? describe : describe.skip;

const SKIN_A = "11111111-1111-1111-1111-111111111111";
const SKIN_B = "22222222-2222-2222-2222-222222222222";
const TEST_PASSWORD = "wishlist-rls-test-pw-12345!";

d("Feature: wishlist RLS 격리 (integration)", () => {
  let admin: SupabaseClient;
  let userA: { id: string; email: string; client: SupabaseClient };
  let userB: { id: string; email: string; client: SupabaseClient };

  beforeAll(async () => {
    admin = createClient(URL ?? "", SERVICE_KEY ?? "", {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const stamp = Date.now();
    const emailA = `wlist-rls-a-${stamp}@test.local`;
    const emailB = `wlist-rls-b-${stamp}@test.local`;

    const created = await Promise.all([
      admin.auth.admin.createUser({ email: emailA, password: TEST_PASSWORD, email_confirm: true }),
      admin.auth.admin.createUser({ email: emailB, password: TEST_PASSWORD, email_confirm: true }),
    ]);
    if (created[0].error) throw new Error(`createUser A: ${created[0].error.message}`);
    if (created[1].error) throw new Error(`createUser B: ${created[1].error.message}`);

    const idA = created[0].data.user.id;
    const idB = created[1].data.user.id;

    const clientA = createClient(URL ?? "", ANON_KEY ?? "", { auth: { persistSession: false } });
    const clientB = createClient(URL ?? "", ANON_KEY ?? "", { auth: { persistSession: false } });
    const signed = await Promise.all([
      clientA.auth.signInWithPassword({ email: emailA, password: TEST_PASSWORD }),
      clientB.auth.signInWithPassword({ email: emailB, password: TEST_PASSWORD }),
    ]);
    if (signed[0].error) throw new Error(`signIn A: ${signed[0].error.message}`);
    if (signed[1].error) throw new Error(`signIn B: ${signed[1].error.message}`);

    userA = { id: idA, email: emailA, client: clientA };
    userB = { id: idB, email: emailB, client: clientB };
  }, 30_000);

  afterAll(async () => {
    await admin.from("wishlist").delete().in("user_id", [userA.id, userB.id]);
    await Promise.allSettled([
      admin.auth.admin.deleteUser(userA.id),
      admin.auth.admin.deleteUser(userB.id),
    ]);
  }, 30_000);

  it("givenUserARowSeededByServiceRole_whenUserBJWTSelects_thenZeroRows", async () => {
    await admin.from("wishlist").delete().eq("user_id", userA.id);
    const seed = await admin
      .from("wishlist")
      .insert({ user_id: userA.id, skin_uuid: SKIN_A });
    expect(seed.error).toBeNull();

    const { data, error } = await userB.client.from("wishlist").select("skin_uuid");
    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);
  });

  it("givenUserBJWT_whenInsertWithUserAId_thenRLSRejects", async () => {
    const { error } = await userB.client
      .from("wishlist")
      .insert({ user_id: userA.id, skin_uuid: SKIN_B });

    if (error === null) throw new Error("expected error to be non-null");
    expect(error.code === "42501" || /row-level security/i.test(error.message)).toBe(true);

    const check = await admin
      .from("wishlist")
      .select("skin_uuid")
      .eq("user_id", userA.id)
      .eq("skin_uuid", SKIN_B);
    expect(check.data ?? []).toEqual([]);
  });

  it("givenAnonClient_whenSelect_thenZeroRows", async () => {
    const anon = createClient(URL ?? "", ANON_KEY ?? "", { auth: { persistSession: false } });
    const { data, error } = await anon.from("wishlist").select("skin_uuid");
    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);
  });

  it("givenServiceRoleClient_whenSelectAll_thenAllRowsVisible", async () => {
    await admin.from("wishlist").delete().in("user_id", [userA.id, userB.id]);
    await Promise.all([
      admin.from("wishlist").insert({ user_id: userA.id, skin_uuid: SKIN_A }),
      admin.from("wishlist").insert({ user_id: userB.id, skin_uuid: SKIN_B }),
    ]);

    const { data, error } = await admin
      .from("wishlist")
      .select("user_id, skin_uuid")
      .in("user_id", [userA.id, userB.id]);
    expect(error).toBeNull();
    const ids = new Set((data ?? []).map((r) => r.user_id));
    expect(ids.has(userA.id) && ids.has(userB.id)).toBe(true);
  });

  it("given50RowsForUserA_whenListFor_thenReadUnder100ms", async () => {
    /**
     * Plan 0016 Test 4-2 의 1000 rows × 50 users p95 < 100ms 풀 부하 측정은
     * vitest 기본 환경의 단일 latency 측정으로 의미가 약하고, k6/autocannon 등
     * 별도 부하 도구가 필요하므로 deferred. 본 테스트는 인덱스(user_id 단일 조회 =
     * PK leftmost prefix) 의 기본 동작을 50 rows 규모로 smoke-check 만 수행.
     */
    await admin.from("wishlist").delete().eq("user_id", userA.id);
    const rows = Array.from({ length: 50 }, (_, i) => ({
      user_id: userA.id,
      skin_uuid: `aaaaaaaa-aaaa-aaaa-aaaa-${String(i).padStart(12, "0")}`,
    }));
    await admin.from("wishlist").insert(rows);

    const t0 = performance.now();
    const { data, error } = await userA.client.from("wishlist").select("skin_uuid");
    const elapsed = performance.now() - t0;

    expect(error).toBeNull();
    expect((data ?? []).length).toBe(50);
    expect(elapsed).toBeLessThan(100);
  });
});
