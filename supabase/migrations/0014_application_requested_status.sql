-- v2 M1 · 1.2 Distinct "Requested interview" status
--
-- Adds a new application status value, 'requested', for participant-initiated
-- interview requests — distinct from the legacy 'applied'. New requests use it
-- (see createApplication); existing 'applied' rows are left untouched (no data
-- migration this milestone). The status flow becomes:
--   requested → interviewing → offered → placed   (or withdrawn at any point)
--
-- Paste into Supabase Dashboard → SQL Editor → New query → Run. Idempotent.

-- Drop the existing status CHECK by its definition (name is auto-generated), then
-- re-add it with 'requested' included.
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
  check (status in ('requested', 'applied', 'interviewing', 'offered', 'placed', 'withdrawn'));
