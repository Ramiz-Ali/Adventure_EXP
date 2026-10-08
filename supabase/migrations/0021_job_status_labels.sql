-- v2 M3 · 1.4 Job status labels
--
-- New statuses: posted / accepting / filling / filled (labels: Posted /
-- Accepting interviews / Spots filling / Filled) replace the old open / filling.
-- The app normalizes legacy values on the fly (open→accepting, closed→filled),
-- so both parts below are safe in either order.
--
-- ============================================================================
-- PART A — apply NOW (additive, safe). Widens the allowed set to include the new
-- values alongside the legacy ones, and defaults new jobs to 'posted'. No
-- existing row changes, nothing breaks.
-- ============================================================================
do $$
declare c text;
begin
  select conname into c from pg_constraint
   where conrelid = 'jobs'::regclass and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%status%'
   limit 1;
  if c is not null then execute format('alter table jobs drop constraint %I', c); end if;
end $$;

alter table jobs
  add constraint jobs_status_check
  check (status in ('posted','accepting','filling','filled','open','closed'));

alter table jobs alter column status set default 'posted';

-- ============================================================================
-- PART B — RUN IN THE MAINTENANCE WINDOW ONLY (changes existing data).
-- Converts legacy job statuses to the new set, then tightens the constraint to
-- the four new values. Uncomment and run during the 12–5 AM window.
-- ============================================================================
-- update jobs set status = 'accepting' where status = 'open';
-- update jobs set status = 'filled'    where status = 'closed';
--
-- alter table jobs drop constraint jobs_status_check;
-- alter table jobs add constraint jobs_status_check
--   check (status in ('posted','accepting','filling','filled'));
