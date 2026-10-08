-- v2 M3 · Login-page notice
--
-- A single-row settings table holding an admin-toggleable notice shown on the
-- login/auth screens (for the maintenance window and future updates). Copy is
-- provided by Adam; placeholder until then.
--
-- Publicly readable because the login page is shown pre-authentication (anon key).
-- Only admins can change it. Additive/safe — no existing data is modified.
--
-- Paste into Supabase Dashboard → SQL Editor → New query → Run. Idempotent.

create table if not exists app_settings (
  id                   int primary key default 1 check (id = 1),
  login_notice_enabled boolean not null default false,
  login_notice_text    text,
  updated_at           timestamptz not null default now(),
  updated_by           uuid references profiles(id)
);

insert into app_settings (id) values (1) on conflict (id) do nothing;

alter table app_settings enable row level security;

-- Anyone (incl. anonymous, pre-login) can read the notice.
drop policy if exists app_settings_select_all on app_settings;
create policy app_settings_select_all on app_settings
  for select using (true);

-- Only admins can change it.
drop policy if exists app_settings_write_admin on app_settings;
create policy app_settings_write_admin on app_settings
  for all using (is_admin()) with check (is_admin());
