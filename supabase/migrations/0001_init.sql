-- AdventureEXP — initial schema, RLS, storage, RPCs.
-- Paste this entire file into Supabase Dashboard → SQL Editor → New query → Run.
-- Re-runnable: every statement is idempotent. Safe to run again if you need to fix something.

-- ============================================================================
-- 1. TABLES
-- ============================================================================

-- profiles: extends auth.users with role + display fields
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'participant' check (role in ('participant', 'admin')),
  first_name text not null default '',
  last_name text,
  email text not null unique,
  timezone text,
  photo_url text,
  bio text,
  location text,
  age int,
  visibility boolean default true,
  profile_score int default 0,
  pathway text,
  approved boolean default false,
  admin_notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists profiles_role_idx on profiles (role);

-- notification_settings: one row per user, auto-created at signup
create table if not exists notification_settings (
  user_id uuid primary key references profiles(id) on delete cascade,
  in_system_enabled boolean default true,
  email_enabled boolean default true,
  updated_at timestamptz default now()
);

-- program_profile: the 6-section matchmaking questionnaire
create table if not exists program_profile (
  user_id uuid primary key references profiles(id) on delete cascade,
  -- Section 1: Availability & Timing
  start_date date,
  end_date date,
  min_duration text check (min_duration in ('2-3', '3-4', '4-6', 'open')),
  flex text check (flex in ('none', 'somewhat', 'very')),
  license text check (license in ('yes', 'no', 'unsure')),
  passport text check (passport in ('yes', 'no', 'unsure')),
  car text check (car in ('yes', 'no', 'unsure')),
  -- Section 2: Role Preferences
  roles text[] default '{}',
  avoid_text text,
  priority text check (priority in ('role', 'balanced', 'location')),
  -- Section 3: Location & Lifestyle
  envs text[] default '{}',
  housing_pref text check (housing_pref in ('prefer', 'independent', 'open')),
  rec_importance text check (rec_importance in ('very', 'somewhat', 'not')),
  hobbies text[] default '{}',
  -- Section 4: Financial Goals
  fin_goal text check (fin_goal in ('save', 'break-even', 'earn-lifestyle')),
  savings text check (savings in ('0-2k', '2-4k', '4-6k', '6k+', 'not-sure')),
  income text check (income in ('guaranteed', 'tips', 'mixed')),
  -- Section 5: Flexibility & Mindset
  alt_open text check (alt_open in ('very', 'somewhat', 'prefer-wait')),
  mindset text check (mindset in ('adapt', 'uncertain', 'structure')),
  -- Section 6: Final
  extra_notes text,
  success_meaning text,
  updated_at timestamptz default now()
);

-- employers
create table if not exists employers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact_name text,
  contact_title text,
  email text,
  phone text,
  description text,
  website text,
  industry text,
  address text,
  city text,
  state text,
  zip text,
  region text,
  employee_count int,
  nearest_airport text,
  transportation text,
  benefits text,
  pay_frequency text check (pay_frequency in ('weekly', 'biweekly', 'monthly')),
  drug_testing boolean default false,
  interview_contact text,
  interview_method text check (interview_method in ('phone', 'video', 'in-person')),
  housing_desc text,
  housing_cost numeric,
  housing_inclusions text,
  housing_coed boolean,
  housing_bedrooms int,
  housing_beds_per_room int,
  housing_kitchen boolean,
  housing_address text,
  housing_deposit numeric,
  housing_refund_policy text,
  hiring_start_month text,
  hiring_end_month text,
  logo_url text,
  photos text[] default '{}',
  verified boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists employers_region_idx on employers (region);
create index if not exists employers_industry_idx on employers (industry);

-- jobs
create table if not exists jobs (
  id uuid primary key default gen_random_uuid(),
  employer_id uuid not null references employers(id) on delete cascade,
  title text not null,
  description text,
  qualifications text,
  pay_rate numeric not null,
  positions int not null default 1,
  filled int default 0,
  season text check (season in ('winter', 'spring', 'summer', 'fall', 'year-round')),
  start_month text,
  start_date date,
  end_date date,
  end_month text,
  hours_per_week int,
  experience text check (experience in ('none', 'preferred', 'required')),
  env text,
  job_roles text[] default '{}',
  hobbies text[] default '{}',
  savings_level text check (savings_level in ('low', 'mid', 'high')),
  housing_type text,
  housing_cost numeric default 0,
  meals text,
  requires_license boolean default false,
  requires_passport boolean default false,
  is_tipped boolean default false,
  cpi int check (cpi between 1 and 15),
  status text default 'open' check (status in ('open', 'filled', 'closed')),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists jobs_employer_idx on jobs (employer_id);
create index if not exists jobs_status_idx on jobs (status);
create index if not exists jobs_season_idx on jobs (season);

-- applications
create table if not exists applications (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references profiles(id) on delete cascade,
  job_id uuid not null references jobs(id) on delete cascade,
  status text not null default 'applied'
    check (status in ('applied', 'interviewing', 'offered', 'placed', 'withdrawn')),
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (participant_id, job_id)
);
create index if not exists applications_participant_idx on applications (participant_id);
create index if not exists applications_job_idx on applications (job_id);
create index if not exists applications_status_idx on applications (status);

-- messages
create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references applications(id) on delete cascade,
  sender_id uuid not null references profiles(id) on delete cascade,
  body text not null,
  read_at timestamptz,
  created_at timestamptz default now()
);
create index if not exists messages_app_idx on messages (application_id, created_at desc);

-- reviews
create table if not exists reviews (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid references profiles(id) on delete set null,
  participant_name text,
  employer_id uuid references employers(id) on delete set null,
  job_id uuid references jobs(id) on delete set null,
  rating int not null check (rating between 1 and 5),
  comments text,
  created_at timestamptz default now()
);
create index if not exists reviews_employer_idx on reviews (employer_id);

-- notifications
create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references profiles(id) on delete cascade,
  event_type text not null,
  payload jsonb default '{}',
  read_at timestamptz,
  created_at timestamptz default now()
);
create index if not exists notifications_recipient_idx
  on notifications (recipient_id, created_at desc);
create index if not exists notifications_unread_idx
  on notifications (recipient_id) where read_at is null;

-- favorites (saved jobs per participant)
create table if not exists favorites (
  participant_id uuid references profiles(id) on delete cascade,
  job_id uuid references jobs(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (participant_id, job_id)
);

-- ============================================================================
-- 2. HELPER FUNCTIONS
-- ============================================================================

-- is_admin(): used in RLS policies. security definer so it can read profiles
-- even when the caller's RLS would block.
create or replace function is_admin() returns boolean
language sql security definer stable
set search_path = public
as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and role = 'admin'
  )
$$;

-- handle_new_user(): auto-creates profiles + notification_settings on signup
-- `set search_path = public` is REQUIRED — without it, the function runs in
-- the auth schema context and cannot resolve `profiles` / `notification_settings`,
-- causing "Database error creating new user" on Auth → Add user.
create or replace function handle_new_user() returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  insert into profiles (id, email, first_name, last_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'first_name', ''),
    coalesce(new.raw_user_meta_data->>'last_name', ''),
    'participant'
  )
  on conflict (id) do nothing;

  insert into notification_settings (user_id) values (new.id)
  on conflict (user_id) do nothing;

  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- compute_cpi(): CPI formula. Never expose to client.
create or replace function compute_cpi() returns trigger
language plpgsql as $$
declare
  monthly_earnings numeric;
  net numeric;
  raw_cpi numeric;
begin
  monthly_earnings := coalesce(new.pay_rate, 0) * 35 * 4;
  net := monthly_earnings - coalesce(new.housing_cost, 0);
  raw_cpi := round((net / 2300.0) * 10);
  new.cpi := greatest(1, least(15, raw_cpi::int));
  return new;
end $$;

drop trigger if exists jobs_compute_cpi on jobs;
create trigger jobs_compute_cpi
  before insert or update of pay_rate, housing_cost on jobs
  for each row execute function compute_cpi();

-- recompute_profile_meta(): updates profile_score + pathway on program_profile write
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
    when new.fin_goal = 'save' and new.savings in ('4-6k', '6k+') then 'High Earner'
    when new.fin_goal = 'earn-lifestyle' and new.alt_open = 'very' then 'Adventure Seeker'
    when new.mindset = 'structure' then 'Structured Achiever'
    when 'mountain' = any(new.envs) then 'Mountain Pursuer'
    when 'coastal' = any(new.envs) then 'Coastal Explorer'
    else 'Explorer'
  end;

  update profiles set profile_score = pct, pathway = pw where id = new.user_id;
  return new;
end $$;

drop trigger if exists program_profile_meta on program_profile;
create trigger program_profile_meta
  after insert or update on program_profile
  for each row execute function recompute_profile_meta();

-- touch_updated_at(): generic timestamp bump
create or replace function touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'profiles', 'program_profile', 'employers', 'jobs',
    'applications', 'notification_settings'
  ]
  loop
    execute format(
      'drop trigger if exists touch_%I on %I; ' ||
      'create trigger touch_%I before update on %I ' ||
      '  for each row execute function touch_updated_at()',
      t, t, t, t
    );
  end loop;
end $$;

-- place_application(): admin-only RPC that moves status to placed AND bumps job.filled
create or replace function place_application(app_id uuid) returns void
language plpgsql security definer
set search_path = public
as $$
declare
  job_uuid uuid;
  job_positions int;
  job_filled int;
begin
  if not is_admin() then
    raise exception 'admin only';
  end if;

  update applications set status = 'placed', updated_at = now()
    where id = app_id
    returning job_id into job_uuid;

  if job_uuid is null then return; end if;

  update jobs set filled = coalesce(filled, 0) + 1
    where id = job_uuid
    returning positions, filled into job_positions, job_filled;

  if job_filled >= job_positions then
    update jobs set status = 'filled' where id = job_uuid;
  end if;
end $$;

revoke all on function place_application(uuid) from public;
grant execute on function place_application(uuid) to authenticated;

-- ============================================================================
-- 3. ROW LEVEL SECURITY
-- ============================================================================

alter table profiles               enable row level security;
alter table program_profile        enable row level security;
alter table employers              enable row level security;
alter table jobs                   enable row level security;
alter table applications           enable row level security;
alter table messages               enable row level security;
alter table reviews                enable row level security;
alter table notifications          enable row level security;
alter table notification_settings  enable row level security;
alter table favorites              enable row level security;

-- profiles
drop policy if exists profiles_select_own_or_admin on profiles;
create policy profiles_select_own_or_admin on profiles
  for select using (id = auth.uid() or is_admin());

drop policy if exists profiles_update_own_or_admin on profiles;
create policy profiles_update_own_or_admin on profiles
  for update using (id = auth.uid() or is_admin())
  with check (id = auth.uid() or is_admin());

-- program_profile
drop policy if exists program_profile_all_own_or_admin on program_profile;
create policy program_profile_all_own_or_admin on program_profile
  for all
  using (user_id = auth.uid() or is_admin())
  with check (user_id = auth.uid() or is_admin());

-- employers
drop policy if exists employers_select_all on employers;
create policy employers_select_all on employers
  for select using (auth.uid() is not null);

drop policy if exists employers_write_admin on employers;
create policy employers_write_admin on employers
  for all using (is_admin()) with check (is_admin());

-- jobs
drop policy if exists jobs_select_all on jobs;
create policy jobs_select_all on jobs
  for select using (auth.uid() is not null);

drop policy if exists jobs_write_admin on jobs;
create policy jobs_write_admin on jobs
  for all using (is_admin()) with check (is_admin());

-- applications
drop policy if exists applications_select_own_or_admin on applications;
create policy applications_select_own_or_admin on applications
  for select using (participant_id = auth.uid() or is_admin());

drop policy if exists applications_insert_own on applications;
create policy applications_insert_own on applications
  for insert with check (participant_id = auth.uid());

drop policy if exists applications_update_admin on applications;
create policy applications_update_admin on applications
  for update using (is_admin()) with check (is_admin());

drop policy if exists applications_withdraw_own on applications;
create policy applications_withdraw_own on applications
  for update using (participant_id = auth.uid())
  with check (participant_id = auth.uid() and status = 'withdrawn');

-- messages
drop policy if exists messages_select_in_thread on messages;
create policy messages_select_in_thread on messages
  for select using (
    is_admin()
    or exists (
      select 1 from applications a
      where a.id = application_id and a.participant_id = auth.uid()
    )
  );

drop policy if exists messages_insert_in_thread on messages;
create policy messages_insert_in_thread on messages
  for insert with check (
    sender_id = auth.uid()
    and (
      is_admin()
      or exists (
        select 1 from applications a
        where a.id = application_id and a.participant_id = auth.uid()
      )
    )
  );

drop policy if exists messages_mark_read on messages;
create policy messages_mark_read on messages
  for update using (
    is_admin()
    or exists (
      select 1 from applications a
      where a.id = application_id and a.participant_id = auth.uid()
    )
  ) with check (true);

-- reviews
drop policy if exists reviews_select_all on reviews;
create policy reviews_select_all on reviews
  for select using (auth.uid() is not null);

drop policy if exists reviews_write_admin on reviews;
create policy reviews_write_admin on reviews
  for all using (is_admin()) with check (is_admin());

-- Participants can insert reviews they author.
drop policy if exists reviews_insert_own on reviews;
create policy reviews_insert_own on reviews
  for insert
  with check (
    auth.uid() is not null
    and (participant_id = auth.uid() or is_admin())
  );

-- Participants can delete their own reviews (admins can delete anyone's).
drop policy if exists reviews_delete_own on reviews;
create policy reviews_delete_own on reviews
  for delete
  using (participant_id = auth.uid() or is_admin());

-- notifications
drop policy if exists notifications_select_own on notifications;
create policy notifications_select_own on notifications
  for select using (recipient_id = auth.uid());

drop policy if exists notifications_mark_read on notifications;
create policy notifications_mark_read on notifications
  for update using (recipient_id = auth.uid())
  with check (recipient_id = auth.uid());

-- notification_settings
drop policy if exists notification_settings_all_own on notification_settings;
create policy notification_settings_all_own on notification_settings
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists notification_settings_select_admin on notification_settings;
create policy notification_settings_select_admin on notification_settings
  for select using (is_admin());

-- favorites
drop policy if exists favorites_all_own on favorites;
create policy favorites_all_own on favorites
  for all using (participant_id = auth.uid())
  with check (participant_id = auth.uid());

-- ============================================================================
-- 4. STORAGE BUCKETS
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('profile-photos',  'profile-photos',  true, 2097152, array['image/jpeg', 'image/png', 'image/webp']),
  ('employer-photos', 'employer-photos', true, 4194304, array['image/jpeg', 'image/png', 'image/webp']),
  ('housing-photos',  'housing-photos',  true, 4194304, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- profile-photos policies (path convention: <user-id>/<filename>)
drop policy if exists profile_photos_read on storage.objects;
create policy profile_photos_read on storage.objects
  for select using (bucket_id = 'profile-photos');

drop policy if exists profile_photos_write_own on storage.objects;
create policy profile_photos_write_own on storage.objects
  for insert with check (
    bucket_id = 'profile-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists profile_photos_update_own on storage.objects;
create policy profile_photos_update_own on storage.objects
  for update using (
    bucket_id = 'profile-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists profile_photos_delete_own on storage.objects;
create policy profile_photos_delete_own on storage.objects
  for delete using (
    bucket_id = 'profile-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- employer-photos policies (admin write only)
drop policy if exists employer_photos_read on storage.objects;
create policy employer_photos_read on storage.objects
  for select using (bucket_id = 'employer-photos');

drop policy if exists employer_photos_write_admin on storage.objects;
create policy employer_photos_write_admin on storage.objects
  for insert with check (bucket_id = 'employer-photos' and is_admin());

drop policy if exists employer_photos_update_admin on storage.objects;
create policy employer_photos_update_admin on storage.objects
  for update using (bucket_id = 'employer-photos' and is_admin());

drop policy if exists employer_photos_delete_admin on storage.objects;
create policy employer_photos_delete_admin on storage.objects
  for delete using (bucket_id = 'employer-photos' and is_admin());

-- housing-photos policies (admin write only)
drop policy if exists housing_photos_read on storage.objects;
create policy housing_photos_read on storage.objects
  for select using (bucket_id = 'housing-photos');

drop policy if exists housing_photos_write_admin on storage.objects;
create policy housing_photos_write_admin on storage.objects
  for insert with check (bucket_id = 'housing-photos' and is_admin());

drop policy if exists housing_photos_update_admin on storage.objects;
create policy housing_photos_update_admin on storage.objects
  for update using (bucket_id = 'housing-photos' and is_admin());

drop policy if exists housing_photos_delete_admin on storage.objects;
create policy housing_photos_delete_admin on storage.objects
  for delete using (bucket_id = 'housing-photos' and is_admin());

-- ============================================================================
-- DONE
-- After running this file:
--   1. Confirm 10 tables in Table Editor:
--      profiles, program_profile, employers, jobs, applications,
--      messages, reviews, notifications, notification_settings, favorites
--   2. Confirm 3 storage buckets:
--      profile-photos, employer-photos, housing-photos
--   3. Confirm 6 database functions:
--      is_admin, handle_new_user, compute_cpi, recompute_profile_meta,
--      touch_updated_at, place_application
--   4. Auth → Sign In / Providers → Email → toggle "Confirm email" OFF for dev
--      (turn back ON before production launch)
--   5. Bootstrap the first admin (instructions below)
-- ============================================================================

-- ============================================================================
-- BOOTSTRAP THE FIRST ADMIN
-- ============================================================================
-- Step A: In Supabase Dashboard → Authentication → Users → "Add user":
--           Email:    <pick any email>
--           Password: <strong password>
--           Auto Confirm User: ON
--         The handle_new_user trigger automatically creates a row in `profiles`
--         with role = 'participant' for the new user.
--
-- Step B: Replace 'YOUR_ADMIN_EMAIL_HERE' below with the email you just used
--         and run this UPDATE in the SQL Editor:
--
--   update profiles
--   set role = 'admin', approved = true
--   where email = 'YOUR_ADMIN_EMAIL_HERE';
--
-- Step C: Verify:
--   select id, email, role, approved
--   from profiles
--   where email = 'YOUR_ADMIN_EMAIL_HERE';
--   -- Expect: role = 'admin', approved = true
--
-- To create additional admins later, repeat steps A + B for each new account.
-- ============================================================================
