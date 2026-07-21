-- 0011_employer_variable_housing.sql
-- Beds-per-bedroom and housing-deposit are variable in real listings
-- ("1-2" beds, deposit "one month rent" or "$200-850"), but the columns were
-- number-typed so only single numbers could be stored. Convert both to text so
-- admins can enter ranges / descriptive values. These fields are display-only
-- (not used in matching/CPI), so widening the type is safe. Existing numeric
-- values are preserved via the ::text cast.

alter table employers
  alter column housing_beds_per_room type text using housing_beds_per_room::text;

alter table employers
  alter column housing_deposit type text using housing_deposit::text;
