-- v2 M3 · 1.6 Vehicle required
--
-- Adds a "requires vehicle" flag to job postings. It feeds the match score the
-- same way "requires driver license" does: a job that needs a vehicle is scored
-- down for a participant who won't bring one (participant question 1.7 "Do you
-- plan to bring a car?" → program_profile.car). Match % is computed live in the
-- client, so no stored re-run is needed — results update when the scoring change
-- ships (do that in the maintenance window).
--
-- Additive & safe: defaults to false, so no existing job changes until an admin
-- ticks the box.
--
-- Paste into Supabase Dashboard → SQL Editor → New query → Run. Idempotent.

alter table jobs add column if not exists requires_vehicle boolean default false;
