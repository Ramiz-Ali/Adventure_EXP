-- v2 M2 · 2.2 Coordinator match
--
-- An admin flags a specific job for a specific participant. The participant's
-- dashboard shows a "Your coordinator matched you with a position" card that
-- links to the job (where they can request an interview), and they get an email.
--
-- Paste into Supabase Dashboard → SQL Editor → New query → Run. Idempotent.

create table if not exists coordinator_matches (
  id             uuid primary key default gen_random_uuid(),
  participant_id uuid not null references profiles(id) on delete cascade,
  job_id         uuid not null references jobs(id)     on delete cascade,
  note           text,
  created_by     uuid references profiles(id),
  created_at     timestamptz not null default now(),
  unique (participant_id, job_id)   -- one match per participant+job
);

create index if not exists coordinator_matches_participant_idx
  on coordinator_matches (participant_id);

alter table coordinator_matches enable row level security;

-- Participant sees their own matches; admin sees all.
drop policy if exists coordinator_matches_select on coordinator_matches;
create policy coordinator_matches_select on coordinator_matches
  for select using (participant_id = auth.uid() or is_admin());

-- Only admins create/remove matches.
drop policy if exists coordinator_matches_write_admin on coordinator_matches;
create policy coordinator_matches_write_admin on coordinator_matches
  for all using (is_admin()) with check (is_admin());

-- On a new match, notify the participant (row → email via the existing webhook).
create or replace function notify_participant_coordinator_match() returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  job_title text;
  employer_name text;
begin
  select j.title, e.name
    into job_title, employer_name
    from jobs j left join employers e on e.id = j.employer_id
    where j.id = new.job_id;

  insert into notifications (recipient_id, event_type, payload)
  values (
    new.participant_id,
    'coordinator_match',
    jsonb_build_object(
      'job_id', new.job_id,
      'job_title', coalesce(job_title, ''),
      'employer_name', coalesce(employer_name, '')
    )
  );
  return new;
end $$;

drop trigger if exists cm_notify_participant on coordinator_matches;
create trigger cm_notify_participant
  after insert on coordinator_matches
  for each row execute function notify_participant_coordinator_match();
