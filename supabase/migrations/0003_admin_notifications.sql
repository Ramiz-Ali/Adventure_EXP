-- Admin-initiated notifications.
--
-- The DB triggers in 0002 cover the three event sources that fire from DB writes
-- (new application, application status change, new message). Two more events
-- in the spec — employer_verification_request and incomplete_profile_reminder —
-- are admin-initiated from the UI, with no underlying DB write to hook into.
--
-- This migration lets admins insert directly into `notifications`. The existing
-- Database Webhook on `notifications` INSERT then drives the email side via
-- the send-notification edge function, same as every other event.
--
-- Paste into Supabase Dashboard → SQL Editor → New query → Run. Idempotent.

drop policy if exists notifications_insert_admin on notifications;
create policy notifications_insert_admin on notifications
  for insert
  with check (is_admin());
