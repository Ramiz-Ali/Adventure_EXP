-- v2 M3 · 1.5 Savings range bands
--
-- Q4.2 bands change to: 0-1k / 1-3k / 3-4k / 4k+ / not-sure (labels $0-$1,000 …
-- $4,000+). The Financial-Goals score maps the new bands to job tiers in
-- lib/matching.js. Pathway ("High Earner") is computed both client-side and by
-- the recompute_profile_meta trigger — this migration keeps the trigger in sync.
--
-- ============================================================================
-- PART A — apply NOW (additive, safe). Widens the savings CHECK to allow the new
-- bands (keeping legacy so un-migrated answers stay valid), and updates ONLY the
-- pathway savings-band line in recompute_profile_meta (otherwise an exact copy
-- of the 0001 function). No row changes.
-- ============================================================================
alter table program_profile drop constraint if exists program_profile_savings_check;
alter table program_profile
  add constraint program_profile_savings_check
  check (savings in ('0-1k','1-3k','3-4k','4k+','not-sure','0-2k','2-4k','4-6k','6k+'));

create or replace function recompute_profile_meta() returns trigger
language plpgsql as $$
declare
  pct int;
  pw text;
begin
  pct := (
    (case when new.start_date is not null then 1 else 0 end) +
    (case when new.end_date is not null then 1 else 0 end) +
    (case when new.min_duration is not null then 1 else 0 end) +
    (case when new.flex is not null then 1 else 0 end) +
    (case when new.license is not null then 1 else 0 end) +
    (case when new.priority is not null then 1 else 0 end) +
    (case when new.fin_goal is not null then 1 else 0 end) +
    (case when new.savings is not null then 1 else 0 end) +
    (case when new.income is not null then 1 else 0 end) +
    (case when new.alt_open is not null then 1 else 0 end) +
    (case when new.mindset is not null then 1 else 0 end) +
    (case when array_length(new.roles, 1) > 0 then 1 else 0 end) +
    (case when array_length(new.envs, 1) > 0 then 1 else 0 end) +
    (case when array_length(new.hobbies, 1) > 0 then 1 else 0 end)
  ) * 100 / 14;

  pw := case
    when new.fin_goal = 'save' and new.savings in ('4k+', '4-6k', '6k+') then 'High Earner'
    when new.fin_goal = 'earn-lifestyle' and new.alt_open = 'very' then 'Adventure Seeker'
    when new.mindset = 'structure' then 'Structured Achiever'
    when 'mountain' = any(new.envs) then 'Mountain Pursuer'
    when 'coastal' = any(new.envs) then 'Coastal Explorer'
    else 'Explorer'
  end;

  update profiles set profile_score = pct, pathway = pw where id = new.user_id;
  return new;
end $$;

-- ============================================================================
-- PART B — RUN IN THE MAINTENANCE WINDOW ONLY (changes existing data + re-runs
-- matches). Converts legacy answers to the new bands; the UPDATE fires
-- recompute_profile_meta per row, re-deriving profile_score + pathway. Job
-- match % is scored live in the client, so no separate re-run is needed.
-- Uncomment and run during the 12–5 AM window.
-- ============================================================================
-- update program_profile set savings = '1-3k' where savings = '0-2k';
-- update program_profile set savings = '3-4k' where savings = '2-4k';
-- update program_profile set savings = '4k+'  where savings in ('4-6k', '6k+');
--
-- alter table program_profile drop constraint program_profile_savings_check;
-- alter table program_profile add constraint program_profile_savings_check
--   check (savings in ('0-1k','1-3k','3-4k','4k+','not-sure'));
