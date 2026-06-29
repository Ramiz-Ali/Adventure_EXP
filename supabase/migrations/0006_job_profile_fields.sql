-- Wave 2 — extra fields for jobs and participant profiles (client feedback).
--
--   Jobs:    multiple environments, pay range, housing-cost range, 21+ flag,
--            social-energy + nightlife descriptors.
--   Profiles: birthdate (→ age), industry interests, skills, interview
--            availability (times/days; timezone already exists), last login.
--
-- Paste into Supabase Dashboard → SQL Editor → New query → Run. Idempotent.

-- ============================================================================
-- Jobs
-- ============================================================================
alter table jobs add column if not exists envs text[] default '{}';
alter table jobs add column if not exists pay_rate_max numeric;       -- optional top of pay range; pay_rate stays the base used for CPI
alter table jobs add column if not exists housing_cost_max numeric;   -- optional top of housing range; housing_cost stays the base used for CPI
alter table jobs add column if not exists age_21 boolean default false;
alter table jobs add column if not exists social_energy text;         -- very-active | active | moderate | relaxed | quiet
alter table jobs add column if not exists nightlife text;             -- extensive | moderate | limited | minimal

-- Backfill the new multi-env array from the existing single env value.
update jobs set envs = array[env]
 where env is not null and (envs is null or envs = '{}');

-- ============================================================================
-- Profiles
-- ============================================================================
alter table profiles add column if not exists birthdate date;
alter table profiles add column if not exists industry_interests text[] default '{}';
alter table profiles add column if not exists skills text;
alter table profiles add column if not exists avail_times text[] default '{}'; -- morning | afternoon | evening
alter table profiles add column if not exists avail_days text[] default '{}';  -- Mon..Sun
alter table profiles add column if not exists last_login timestamptz;

-- CPI is unchanged: still pay_rate (base) × 35 × 4 − housing_cost (base).
-- pay_rate_max / housing_cost_max are display-only ranges.
