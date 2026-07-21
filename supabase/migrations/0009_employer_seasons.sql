-- 0009_employer_seasons.sql
-- The admin "Edit Employer" form has a "Season you are looking to hire staff"
-- multi-select, but the employers table had no column to store it (only `jobs`
-- has a season column). Add a text[] column so those selections persist.
--
-- Values stored: 'winter' | 'spring' | 'summer' | 'fall' | 'year-round'
-- (multiple allowed). Empty selection stores an empty array.

alter table employers
  add column if not exists seasons text[] not null default '{}';
