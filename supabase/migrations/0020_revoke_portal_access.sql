-- v2 M3 · 3.2 Revoke portal access
--
-- Two per-participant admin controls, enforced in RLS (not just the UI):
--   • requests_blocked — participant can still browse, but cannot request
--     interviews or leave reviews.
--   • suspended — participant loses access to their portal data entirely
--     (their own profile row stays readable so the app can show a "suspended"
--     message; everything else is denied).
--
-- Additive & safe: both default to false, so the new policy gates are no-ops
-- until an admin flips a flag — no existing data or behavior changes on apply.
--
-- Paste into Supabase Dashboard → SQL Editor → New query → Run. Idempotent.

alter table profiles add column if not exists requests_blocked boolean not null default false;
alter table profiles add column if not exists suspended        boolean not null default false;

-- Current user's flags (security definer so RLS policies can read profiles).
create or replace function is_suspended() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select suspended from profiles where id = auth.uid()), false);
$$;

create or replace function is_actions_blocked() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select (suspended or requests_blocked) from profiles where id = auth.uid()), false);
$$;

-- ── Block interview requests + reviews when blocked or suspended ────────────
drop policy if exists applications_insert_own on applications;
create policy applications_insert_own on applications
  for insert with check (participant_id = auth.uid() and not is_actions_blocked());

drop policy if exists reviews_insert_own on reviews;
create policy reviews_insert_own on reviews
  for insert
  with check (
    auth.uid() is not null
    and ( (participant_id = auth.uid() and not is_actions_blocked()) or is_admin() )
  );

-- ── Suspend: deny the participant access to their own portal data ────────────
-- (admins still see everything; the participant's own profile row stays
-- readable — not gated here — so the client can detect suspension.)
drop policy if exists applications_select_own_or_admin on applications;
create policy applications_select_own_or_admin on applications
  for select using ((participant_id = auth.uid() and not is_suspended()) or is_admin());

drop policy if exists program_profile_all_own_or_admin on program_profile;
create policy program_profile_all_own_or_admin on program_profile
  for all
  using ((user_id = auth.uid() and not is_suspended()) or is_admin())
  with check ((user_id = auth.uid() and not is_suspended()) or is_admin());

drop policy if exists favorites_all_own on favorites;
create policy favorites_all_own on favorites
  for all
  using (participant_id = auth.uid() and not is_suspended())
  with check (participant_id = auth.uid() and not is_suspended());
