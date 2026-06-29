-- Let admins upload/replace a profile photo on a participant's behalf.
--
-- The profile-photos bucket policies (0001) only allow a user to write to
-- their OWN folder (auth.uid() = first path segment). When an admin uploads a
-- photo for a participant, the path is the participant's id, so the write is
-- rejected with "new row violates row-level security policy". These extra
-- permissive policies grant admins write access to the whole bucket.
--
-- Paste into Supabase Dashboard → SQL Editor → New query → Run. Idempotent.

drop policy if exists profile_photos_write_admin on storage.objects;
create policy profile_photos_write_admin on storage.objects
  for insert
  with check (bucket_id = 'profile-photos' and is_admin());

drop policy if exists profile_photos_update_admin on storage.objects;
create policy profile_photos_update_admin on storage.objects
  for update
  using (bucket_id = 'profile-photos' and is_admin())
  with check (bucket_id = 'profile-photos' and is_admin());

drop policy if exists profile_photos_delete_admin on storage.objects;
create policy profile_photos_delete_admin on storage.objects
  for delete
  using (bucket_id = 'profile-photos' and is_admin());
