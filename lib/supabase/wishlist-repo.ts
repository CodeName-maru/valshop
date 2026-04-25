/**
 * Wishlist Repository — Supabase 어댑터
 *
 * Plan 0016: domain 의 WishlistRepo 포트를 구현 (add/remove/listFor/countFor).
 * Worker (Plan 0008) 는 listFor 만 사용해도 호환된다.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  WISHLIST_LIMIT,
  WishlistLimitExceededError,
  type WishlistRepo as DomainWishlistRepo,
} from "@/lib/domain/wishlist";

// 기존 import 호환을 위한 재수출
export type WishlistRepo = DomainWishlistRepo;

/**
 * Supabase 어댑터 생성.
 * Service Role 클라이언트를 권장 (Route Handler 가 명시적 user_id 필터로 격리 책임).
 */
export function createWishlistRepo(supabase: SupabaseClient): WishlistRepo {
  return {
    async add(userId: string, skinUuid: string): Promise<void> {
      // 1000 한도 사전 체크 (도메인 멱등성 — 이미 존재시 add 는 no-op 이어야 함)
      const { count, error: cErr } = await supabase
        .from("wishlist")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId);
      if (cErr) {
        throw new Error(`Failed to count wishlist: ${cErr.message}`);
      }
      // already exists 체크 — 멱등성
      const { data: existing, error: exErr } = await supabase
        .from("wishlist")
        .select("skin_uuid")
        .eq("user_id", userId)
        .eq("skin_uuid", skinUuid)
        .limit(1);
      if (exErr) {
        throw new Error(`Failed to check wishlist: ${exErr.message}`);
      }
      if (existing.length > 0) {
        return; // 이미 있으면 멱등 no-op
      }
      if ((count ?? 0) >= WISHLIST_LIMIT) {
        throw new WishlistLimitExceededError();
      }
      const { error } = await supabase
        .from("wishlist")
        .insert({ user_id: userId, skin_uuid: skinUuid });
      if (error) {
        // 동시성 race 로 PK 중복이 발생해도 멱등 처리
        if (error.code === "23505") return;
        throw new Error(`Failed to add wishlist: ${error.message}`);
      }
    },

    async remove(userId: string, skinUuid: string): Promise<void> {
      const { error } = await supabase
        .from("wishlist")
        .delete()
        .eq("user_id", userId)
        .eq("skin_uuid", skinUuid);
      if (error) {
        throw new Error(`Failed to remove wishlist: ${error.message}`);
      }
    },

    async listFor(userId: string): Promise<string[]> {
      const { data, error } = await supabase
        .from("wishlist")
        .select("skin_uuid")
        .eq("user_id", userId);

      if (error) {
        throw new Error(`Failed to list wishlist: ${error.message}`);
      }

      const rows = data as { skin_uuid: string }[];
      return rows.map((row) => row.skin_uuid);
    },

    async countFor(userId: string): Promise<number> {
      const { count, error } = await supabase
        .from("wishlist")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId);
      if (error) {
        throw new Error(`Failed to count wishlist: ${error.message}`);
      }
      return count ?? 0;
    },
  };
}
