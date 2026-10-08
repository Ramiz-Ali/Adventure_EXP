-- v2 M2 finalization — "On Program" and "Complete" application statuses, plus a
-- coordinator override to re-open interview requests for a held participant.
--
-- Adam's confirmed rules:
--   • Status flow: requested → interviewing → offered → placed → on-program → complete
--     (withdrawn still available at any point).
--   • Placed, On Program AND Complete all PAUSE interview requests.
--   • Nothing re-opens automatically. A coordinator manually opens requests for an
--     eligible participant via profiles.requests_opened — their status is unchanged.
--
-- Additive & safe to apply any time: widening a CHECK constraint and adding a
-- nullable/defaulted column don't touch existing rows. The cap trigger is replaced
-- in place.
--
-- Paste into Supabase Dashboard → SQL Editor → New query → Run. Idempotent.

-- 1. Allow the two new application statuses. Rebuild the CHECK (its name is stable
--    from 0014: applications_status_check).
do $$
declare c text;
begin
  select conname into c
    from pg_constraint
   where conrelid = 'applications'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%interviewing%'
   limit 1;
  if c is not null then
    execute format('alter table applications drop constraint %I', c);
  end if;
end $$;

alter table applications
  add constraint applications_status_check
  check (status in ('requested', 'applied', 'interviewing', 'offered', 'placed', 'on-program', 'complete', 'withdrawn'));

-- 2. Coordinator override: when true, this participant may request interviews even
--    while Placed / On Program / Complete. Defaults false → no behavior change on
--    apply; existing held participants stay held until a coordinator opens them.
alter table profiles add column if not exists requests_opened boolean not null default false;

-- 3. Interview-request cap trigger — hold on placed/on-program/complete (and any
--    off-portal manual placement), unless the coordinator has opened the account.
create or replace function enforce_interview_request_cap() returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  active_count int;
  on_hold boolean;
  opened  boolean;
begin
  -- Only participant interview requests are capped.
  if new.status <> 'requested' then
    return new;
  end if;

  -- Held if they hold a role on-portal (placed / on program / complete) OR have an
  -- off-portal manual placement.
  select (
    exists(
      select 1 from applications
      where participant_id = new.participant_id
        and status in ('placed', 'on-program', 'complete')
    )
    or exists(
      select 1 from manual_placements
      where participant_id = new.participant_id
    )
  ) into on_hold;

  -- Coordinator override.
  select coalesce((select requests_opened from profiles where id = new.participant_id), false)
    into opened;

  if on_hold and not opened then
    raise exception 'You are not eligible to request interviews right now. Please contact your AdventureEXP coordinator.'
      using errcode = 'P0001';
  end if;

  -- At most 2 open (pending) requests at a time.
  select count(*) into active_count
    from applications
    where participant_id = new.participant_id and status = 'requested';
  if active_count >= 2 then
    raise exception 'You can have at most 2 open interview requests at a time.'
      using errcode = 'P0001';
  end if;

  return new;
end $$;

drop trigger if exists app_enforce_request_cap on applications;
create trigger app_enforce_request_cap
  before insert on applications
  for each row execute function enforce_interview_request_cap();
