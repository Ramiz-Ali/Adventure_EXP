-- Match-profile completion → notify every admin (+ email via the existing
-- send-notification webhook). Mirrors the pattern in 0002_notification_triggers.
--
-- Flow: the participant finishes their match profile → the client stamps
-- program_profile.completed_at (once) → this trigger fans a
-- 'match_profile_completed' notification out to every admin → the Database
-- Webhook on notifications INSERT emails them.
--
-- Paste this entire file into Supabase Dashboard → SQL Editor → New query → Run.
-- Idempotent: safe to re-run.

-- 1. Column that records the first completion (NULL until complete).
alter table public.program_profile
  add column if not exists completed_at timestamptz;

-- 2. On the null → set transition, notify every admin. security definer so it
--    can insert notifications regardless of who triggered the update (the
--    participant, who otherwise can't insert notification rows under RLS).
create or replace function notify_admins_match_profile_completed() returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  participant_name text;
  pathway_val text;
  score_val int;
  admin_row record;
begin
  -- Only fire on the first completion (NULL → NOT NULL).
  if new.completed_at is null or old.completed_at is not null then
    return new;
  end if;

  select
    nullif(trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''),
    p.pathway,
    p.profile_score
  into participant_name, pathway_val, score_val
  from profiles p
  where p.id = new.user_id;

  if participant_name is null or participant_name like '%@%' then
    participant_name := 'A participant';
  end if;

  for admin_row in (select id from profiles where role = 'admin') loop
    insert into notifications (recipient_id, event_type, payload)
    values (
      admin_row.id,
      'match_profile_completed',
      jsonb_build_object(
        'participant_id', new.user_id,
        'participant_name', coalesce(participant_name, 'A participant'),
        'pathway', coalesce(pathway_val, ''),
        'profile_score', coalesce(score_val, 0)
      )
    );
  end loop;

  return new;
end $$;

drop trigger if exists pp_notify_admins_completed on program_profile;
create trigger pp_notify_admins_completed
  after update on program_profile
  for each row execute function notify_admins_match_profile_completed();
