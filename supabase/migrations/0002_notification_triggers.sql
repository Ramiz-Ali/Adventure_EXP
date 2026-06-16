-- Notification triggers — auto-create rows in `notifications` when key events
-- happen. All purely SQL; the email Edge Function will read these same events
-- later when it's built.
--
-- Paste this entire file into Supabase Dashboard → SQL Editor → New query → Run.
-- Idempotent: safe to re-run.

-- ============================================================================
-- 1. New application → notify every admin
-- ============================================================================
create or replace function notify_admins_new_application() returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  participant_name text;
  job_title text;
  employer_name text;
  admin_row record;
begin
  select nullif(trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), '')
    into participant_name
    from profiles p where p.id = new.participant_id;
  if participant_name is null or participant_name like '%@%' then
    participant_name := 'A participant';
  end if;

  select j.title, e.name
    into job_title, employer_name
    from jobs j left join employers e on e.id = j.employer_id
    where j.id = new.job_id;

  for admin_row in (select id from profiles where role = 'admin') loop
    insert into notifications (recipient_id, event_type, payload)
    values (
      admin_row.id,
      'application_received',
      jsonb_build_object(
        'application_id', new.id,
        'participant_name', coalesce(participant_name, 'Someone'),
        'job_title', coalesce(job_title, ''),
        'employer_name', coalesce(employer_name, '')
      )
    );
  end loop;

  return new;
end $$;

drop trigger if exists app_notify_admins on applications;
create trigger app_notify_admins
  after insert on applications
  for each row execute function notify_admins_new_application();

-- ============================================================================
-- 2. Application status change → notify the participant
-- ============================================================================
create or replace function notify_participant_status_change() returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  job_title text;
  employer_name text;
begin
  if new.status = old.status then
    return new;
  end if;

  select j.title, e.name
    into job_title, employer_name
    from jobs j left join employers e on e.id = j.employer_id
    where j.id = new.job_id;

  insert into notifications (recipient_id, event_type, payload)
  values (
    new.participant_id,
    'application_' || new.status,
    jsonb_build_object(
      'application_id', new.id,
      'job_title', coalesce(job_title, ''),
      'employer_name', coalesce(employer_name, ''),
      'status', new.status
    )
  );

  return new;
end $$;

drop trigger if exists app_notify_participant on applications;
create trigger app_notify_participant
  after update of status on applications
  for each row execute function notify_participant_status_change();

-- ============================================================================
-- 3. New message → notify the OTHER side of the thread
-- ============================================================================
create or replace function notify_message_recipient() returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  app_participant uuid;
  sender_role text;
  sender_first text;
  sender_name text;
  admin_row record;
begin
  select participant_id into app_participant
    from applications where id = new.application_id;

  select role, nullif(trim(first_name), '')
    into sender_role, sender_first
    from profiles where id = new.sender_id;

  -- Build a friendly display name:
  --   admin   → always "Your coordinator" (don't leak personal name/email)
  --   participant → first_name, falling back to "A participant"
  if sender_role = 'admin' then
    sender_name := 'Your coordinator';
  else
    sender_name := coalesce(sender_first, 'A participant');
    -- Final guard: if the value contains '@' (email leaked in), mask it.
    if sender_name like '%@%' then sender_name := 'A participant'; end if;
  end if;

  if sender_role = 'admin' then
    insert into notifications (recipient_id, event_type, payload)
    values (
      app_participant,
      'new_message',
      jsonb_build_object(
        'application_id', new.application_id,
        'message_id', new.id,
        'sender_name', sender_name,
        'preview', substring(new.body for 120)
      )
    );
  else
    for admin_row in (select id from profiles where role = 'admin') loop
      insert into notifications (recipient_id, event_type, payload)
      values (
        admin_row.id,
        'new_message',
        jsonb_build_object(
          'application_id', new.application_id,
          'message_id', new.id,
          'sender_name', sender_name,
          'preview', substring(new.body for 120)
        )
      );
    end loop;
  end if;

  return new;
end $$;

drop trigger if exists msg_notify on messages;
create trigger msg_notify
  after insert on messages
  for each row execute function notify_message_recipient();

-- ============================================================================
-- 4. Enable Realtime on notifications so the bell updates live
-- ============================================================================
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table notifications;
  end if;
end $$;
