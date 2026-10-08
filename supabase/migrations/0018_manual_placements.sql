-- v2 M2 · 3.4 Manual placement recording
--
-- Records that a participant was placed off-portal (hired by phone, etc.), with
-- the job details typed in by an admin. Separate from applications because the
-- job may not be a portal listing.
--
-- A recorded manual placement also counts as "placed" for the interview-request
-- cap (2.4), so the participant can't keep requesting interviews after being
-- hired. (To make it record-only instead, drop the manual_placements check from
-- enforce_interview_request_cap below.)
--
-- Paste into Supabase Dashboard → SQL Editor → New query → Run. Idempotent.

create table if not exists manual_placements (
  id             uuid primary key default gen_random_uuid(),
  participant_id uuid not null references profiles(id) on delete cascade,
  employer_name  text not null,
  role_title     text,
  start_date     date,
  notes          text,
  created_by     uuid references profiles(id),
  created_at     timestamptz not null default now()
);

create index if not exists manual_placements_participant_idx
  on manual_placements (participant_id);

alter table manual_placements enable row level security;

-- Participant sees their own placement records; admin sees all.
drop policy if exists manual_placements_select on manual_placements;
create policy manual_placements_select on manual_placements
  for select using (participant_id = auth.uid() or is_admin());

-- Only admins record/edit/remove manual placements.
drop policy if exists manual_placements_write_admin on manual_placements;
create policy manual_placements_write_admin on manual_placements
  for all using (is_admin()) with check (is_admin());

-- Update the 2.4 cap trigger so a manual placement also blocks new requests.
create or replace function enforce_interview_request_cap() returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  active_count int;
  already_placed boolean;
begin
  if new.status <> 'requested' then
    return new;
  end if;

  -- Placed via the portal OR recorded as an off-portal manual placement.
  select
    exists(select 1 from applications where participant_id = new.participant_id and status = 'placed')
    or exists(select 1 from manual_placements where participant_id = new.participant_id)
  into already_placed;
  if already_placed then
    raise exception 'You are already placed and cannot request further interviews.'
      using errcode = 'P0001';
  end if;

  select count(*) into active_count
    from applications
    where participant_id = new.participant_id and status = 'requested';
  if active_count >= 2 then
    raise exception 'You can have at most 2 open interview requests at a time.'
      using errcode = 'P0001';
  end if;

  return new;
end $$;
