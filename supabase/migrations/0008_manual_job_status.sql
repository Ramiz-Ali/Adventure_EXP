-- Job status becomes MANUAL admin control (Open / Filling / Filled), decoupled
-- from application statuses. Placing a participant no longer auto-flips the job
-- to Filled — it only maintains an accurate "placed count" (jobs.filled), which
-- a trigger keeps in sync (so a withdrawal after placement decrements it too).
--
-- Paste into Supabase Dashboard → SQL Editor → New query → Run. Idempotent.

-- 1. Allow the new 'filling' status (keep 'closed' for back-compat).
alter table jobs drop constraint if exists jobs_status_check;
alter table jobs add constraint jobs_status_check
  check (status in ('open', 'filling', 'filled', 'closed'));

-- 2. Keep jobs.filled = exact number of PLACED applications for that job.
--    Runs on insert / status-change / delete so the count never drifts.
create or replace function recompute_job_filled() returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  jid uuid;
begin
  jid := coalesce(new.job_id, old.job_id);
  if jid is not null then
    update jobs set filled = (
      select count(*) from applications a
       where a.job_id = jid and a.status = 'placed'
    ) where id = jid;
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists app_recompute_filled on applications;
create trigger app_recompute_filled
  after insert or delete or update of status on applications
  for each row execute function recompute_job_filled();

-- 3. place_application now ONLY sets the application to 'placed'. The trigger
--    above updates jobs.filled; job.status stays whatever the admin set.
create or replace function place_application(app_id uuid) returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'admin only';
  end if;
  update applications set status = 'placed', updated_at = now()
    where id = app_id;
end $$;

revoke all on function place_application(uuid) from public;
grant execute on function place_application(uuid) to authenticated;

-- 4. One-time backfill so existing rows reflect real placed counts.
update jobs j set filled = (
  select count(*) from applications a where a.job_id = j.id and a.status = 'placed'
);
