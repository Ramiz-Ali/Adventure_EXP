-- Admin "Place" from the Match Jobs modal.
--
-- The flow: from the admin's participant list, "Match jobs" opens a modal that
-- lists every open job ranked by score. Each row has a "Place" button. Clicking
-- it should place that participant in that job — even if no application exists
-- yet.
--
-- The existing `place_application(app_id)` RPC (in 0001_init.sql) only upgrades
-- an *existing* application to 'placed'. It can't be used when the admin is
-- placing someone who never applied themselves.
--
-- This RPC fills that gap. SECURITY DEFINER lets it bypass the
-- applications_insert_own RLS policy (which restricts inserts to the
-- participant themselves) — the function gates on is_admin() instead.
--
-- Paste into Supabase Dashboard → SQL Editor → New query → Run. Idempotent.

create or replace function admin_place_participant(p_participant uuid, p_job uuid)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_app_id uuid;
  v_positions int;
  v_filled int;
begin
  if not is_admin() then
    raise exception 'admin only';
  end if;

  -- Upsert the application. If one already exists for this (participant, job),
  -- flip it to 'placed'. Otherwise create a new row directly in placed state.
  insert into applications (participant_id, job_id, status)
  values (p_participant, p_job, 'placed')
  on conflict (participant_id, job_id) do update
    set status = 'placed', updated_at = now()
  returning id into v_app_id;

  -- Bump filled count + flip job to 'filled' if it's now full. Same logic as
  -- place_application() — kept in sync intentionally.
  update jobs set filled = coalesce(filled, 0) + 1
    where id = p_job
    returning positions, filled into v_positions, v_filled;

  if v_filled >= v_positions then
    update jobs set status = 'filled' where id = p_job;
  end if;

  return v_app_id;
end $$;

revoke all on function admin_place_participant(uuid, uuid) from public;
grant execute on function admin_place_participant(uuid, uuid) to authenticated;
