-- 0010_employer_housing_pics_later.sql
-- The admin "Edit Employer" form has a "Can you provide housing photos later?"
-- yes/no question, but the employers table had no column to store it, so the
-- answer never persisted. Add a boolean column.

alter table employers
  add column if not exists housing_pics_later boolean;
