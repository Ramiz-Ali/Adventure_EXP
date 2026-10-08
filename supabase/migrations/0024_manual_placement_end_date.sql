-- v2 M2 feedback (3) — Record Placement: add an optional End Date alongside the
-- existing Start Date. Additive and nullable, so it is safe to apply any time;
-- existing rows keep end_date = NULL. The admin UI shows dates in US format
-- (MM/DD/YYYY) and lets placements be edited (not only removed).

alter table public.manual_placements
  add column if not exists end_date date;
