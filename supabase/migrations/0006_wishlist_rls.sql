-- Migration 0006: wishlist RLS 정책 분리 (Plan 0016)
-- 기존 0002 의 "service_role only (false)" placeholder 정책을 본인성 정책으로 교체.
-- Service Role Key 는 RLS 를 우회하므로 Plan 0008/0013 워커는 영향 없음.

drop policy if exists "service_role only" on wishlist;
drop policy if exists wishlist_own_select on wishlist;
drop policy if exists wishlist_own_insert on wishlist;
drop policy if exists wishlist_own_delete on wishlist;

create policy wishlist_own_select on wishlist
  for select using (auth.uid() = user_id);

create policy wishlist_own_insert on wishlist
  for insert with check (auth.uid() = user_id);

create policy wishlist_own_delete on wishlist
  for delete using (auth.uid() = user_id);
