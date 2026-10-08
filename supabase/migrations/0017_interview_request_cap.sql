-- v2 M2 · 2.4 Interview-request cap
--
-- A participant may hold at most 2 ACTIVE interview requests (status = 'requested').
-- A slot frees when a request leaves 'requested' (accepted → interviewing, declined
-- → withdrawn, or withdrawn). A participant who is Placed cannot request any.
--
-- Enforced in the DATABASE (not just the UI): a BEFORE INSERT trigger on
-- applications rejects a new 'requested' row that would break either rule. Admin
-- placements (status 'placed', via admin_place_participant) and status changes are
-- unaffected — the trigger only guards new participant requests.
--
-- Paste into Supabase Dashboard → SQL Editor → New query → Run. Idempotent.

create or replace function enforce_interview_request_cap() returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  active_count int;
  already_placed boolean;
begin
  -- Only participant interview requests are capped.
  if new.status <> 'requested' then
    return new;
  end if;

  -- Placed participants cannot request further interviews.
  select exists(
    select 1 from applications
    where participant_id = new.participant_id and status = 'placed'
  ) into already_placed;
  if already_placed then
    raise exception 'You are already placed and cannot request further interviews.'
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
