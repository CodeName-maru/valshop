-- Migration 0008: wishlist 중복 인덱스 제거
-- Plan 0017 P2-#4
-- 근거: PK (user_id, skin_uuid) 의 leftmost prefix 가 user_id 단독 조회를 커버하므로
--       0002_wishlist.sql 에서 만든 idx_wishlist_user(user_id) 는 중복.
--       중복 인덱스는 write amplification + 저장공간 낭비이므로 제거한다.
--       (skin_uuid 단독 조회용 idx_wishlist_skin 은 0005_wishlist.sql 에서 별도 유지.)

drop index if exists idx_wishlist_user;
