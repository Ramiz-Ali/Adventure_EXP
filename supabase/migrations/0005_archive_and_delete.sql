-- Archive + hard-delete support for employers and jobs.
--
-- Client requests:
--   * Archive an employer/job so it's hidden from participants (but admins
--     still see it and can un-archive).
--   * Hard delete (actually removes the row) with confirmation in the UI.
--
-- Archiving is a soft, reversible flag. Deleting relies on the existing
-- `on delete cascade` FKs (deleting an employer removes its jobs, which
-- removes their applications + messages — the UI warns about this).
--
-- Paste into Supabase Dashboard → SQL Editor → New query → Run. Idempotent.

-- ============================================================================
-- 1. Archived flag
-- ============================================================================
alter table employers add column if not exists archived boolean default false;
alter table jobs      add column if not exists archived boolean default false;

create index if not exists employers_archived_idx on employers (archived);
create index if not exists jobs_archived_idx on jobs (archived);

-- ============================================================================
-- 2. RLS — participants must not see archived rows.
--    Admins see everything. A participant can still see a job/employer tied to
--    an application they already submitted, so their "Applied" tab keeps working
--    even after the listing is archived.
-- ============================================================================

-- Employers
drop policy if exists employers_select_all on employers;
drop policy if exists employers_select_visible on employers;
create policy employers_select_visible on employers
  for select using (
    is_admin()
    or archived = false
    or exists (
      select 1
        from jobs j
        join applications a on a.job_id = j.id
       where j.employer_id = employers.id
         and a.participant_id = auth.uid()
    )
  );

-- Jobs
drop policy if exists jobs_select_all on jobs;
drop policy if exists jobs_select_visible on jobs;
create policy jobs_select_visible on jobs
  for select using (
    is_admin()
    or archived = false
    or exists (
      select 1 from applications a
       where a.job_id = jobs.id
         and a.participant_id = auth.uid()
    )
  );

-- Write policies (admin-only for all + delete) are unchanged from 0001:
--   employers_write_admin / jobs_write_admin use `for all using (is_admin())`,
--   which already covers UPDATE (archive) and DELETE (hard delete).
