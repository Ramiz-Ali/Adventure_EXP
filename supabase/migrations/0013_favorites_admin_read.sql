-- v2 M1 · 1.1 Favorites visible to admin
--
-- Let admins read every participant's favorites (starred jobs) so the admin
-- participant view can show what each person has saved. Participants still only
-- see their own via favorites_all_own; this is an ADDITIVE select policy for
-- admins only — it grants no write access and does not widen participant access.
--
-- Paste into Supabase Dashboard → SQL Editor → New query → Run. Idempotent.

drop policy if exists favorites_select_admin on favorites;
create policy favorites_select_admin on favorites
  for select using (is_admin());
