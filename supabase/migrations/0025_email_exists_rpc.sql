-- Forgot-password: let the client check whether an account exists for an email
-- BEFORE sending a reset link, so an unregistered user is told to create an
-- account first instead of silently getting nothing.
--
-- RLS blocks reading other users' profiles with the anon key, so the check must
-- run as a SECURITY DEFINER function. It returns only a boolean (never any row
-- data), is case-insensitive, and trims the input.
--
-- NOTE: this intentionally reveals whether an email is registered (account
-- enumeration), which the product has chosen to accept for clearer UX.

create or replace function public.email_exists(p_email text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where lower(email) = lower(trim(p_email))
  );
$$;

grant execute on function public.email_exists(text) to anon, authenticated;
