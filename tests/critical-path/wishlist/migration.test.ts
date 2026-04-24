/**
 * Tests 3-1, 3-3, 4-3: wishlist 마이그레이션 정적 검증 + RLS 정책 DDL 존재
 * Plan 0016 Phase 3, 4
 *
 * Supabase local 없이도 회귀 가드를 위해 SQL 파일을 정적으로 파싱한다.
 * 실제 DB 측정 (Test 3-2 Scale, Test 4-1/4-2 RLS row visibility) 은
 * tests/integration/wishlist/* 에서 Supabase local 접속 시 실행.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../../..");
const sql0005 = readFileSync(
  resolve(ROOT, "supabase/migrations/0005_wishlist.sql"),
  "utf8"
);
const sql0006 = readFileSync(
  resolve(ROOT, "supabase/migrations/0006_wishlist_rls.sql"),
  "utf8"
);

describe("Test 3-1: 스키마 스냅샷", () => {
  it("givenMigrationsApplied_whenIntrospect_thenWishlistHasExpectedColumns", () => {
    expect(sql0005).toMatch(/create table if not exists wishlist/i);
    expect(sql0005).toMatch(/user_id\s+uuid\s+not null/i);
    expect(sql0005).toMatch(/skin_uuid\s+text\s+not null/i);
    expect(sql0005).toMatch(/created_at\s+timestamptz\s+not null/i);
  });

  it("givenMigrationsApplied_whenInspectPK_thenCompositeUserSkin", () => {
    expect(sql0005).toMatch(/primary key \(user_id,\s*skin_uuid\)/i);
  });

  it("givenMigrationsApplied_whenInspectIndexes_thenIdxWishlistSkinExists", () => {
    expect(sql0005).toMatch(/create index if not exists idx_wishlist_skin on wishlist\(skin_uuid\)/i);
  });

  it("givenMigrationsApplied_whenInspectRLS_thenEnabled", () => {
    expect(sql0005).toMatch(/alter table wishlist enable row level security/i);
  });
});

describe("Test 3-3: PIPA 컬럼 최소성", () => {
  it("givenSchema_whenListColumns_thenNoPIIColumns", () => {
    // 화이트리스트 = {user_id, skin_uuid, created_at}. 다른 컬럼 정의가 없어야 함.
    const forbidden = [
      "email",
      "phone",
      "name",
      "ip_address",
      "address",
      "birthday",
      "puuid",
    ];
    for (const col of forbidden) {
      // 컬럼 선언 라인 패턴 (`<col> <type>`) 가 없어야 함
      const pattern = new RegExp(`^\\s*${col}\\s+\\w+`, "im");
      expect(sql0005).not.toMatch(pattern);
    }
  });
});

describe("Test 4-3: 정책 DDL 존재 (pg_policies 3개)", () => {
  it("givenDB_whenQueryPgPolicies_thenThreePoliciesExistForWishlist", () => {
    expect(sql0006).toMatch(/create policy wishlist_own_select on wishlist\s+for select/i);
    expect(sql0006).toMatch(/create policy wishlist_own_insert on wishlist\s+for insert/i);
    expect(sql0006).toMatch(/create policy wishlist_own_delete on wishlist\s+for delete/i);
    // 본인성 조건
    expect(sql0006).toMatch(/auth\.uid\(\)\s*=\s*user_id/i);
    // 기존 placeholder 정리
    expect(sql0006).toMatch(/drop policy if exists "service_role only" on wishlist/i);
  });
});
