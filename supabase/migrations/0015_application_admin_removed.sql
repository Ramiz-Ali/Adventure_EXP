-- v2 M1 · 1.8 Admin soft-removes an application from the job side
--
-- Adds admin_removed_at: when set, the application is hidden from the
-- employer/job-facing surfaces (candidate lists, message threads, pending
-- counts) but stays in the participant's own history and remains visible to
-- admins (who can restore it). Soft removal — the row is never deleted.
--
-- RLS: no new policy needed. The write is admin-only via the existing
-- applications_update_admin policy; the participant's own SELECT
-- (applications_select_own_or_admin) still returns the row, so their history is
-- intact. No other participant can see it (unchanged).
--
-- Paste into Supabase Dashboard → SQL Editor → New query → Run. Idempotent.

alter table applications
  add column if not exists admin_removed_at timestamptz;
