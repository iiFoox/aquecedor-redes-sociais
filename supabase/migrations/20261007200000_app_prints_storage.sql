-- App 3/5: prints das sessões no Supabase Storage.
-- Bucket privado "screens"; cada arquivo fica em <dono>/<conta>/<arquivo>.jpg e só o dono lê, grava e apaga.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('screens', 'screens', false, 2097152, array['image/jpeg'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy "prints: dono lê" on storage.objects for select to authenticated
  using (bucket_id = 'screens' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "prints: dono grava" on storage.objects for insert to authenticated
  with check (bucket_id = 'screens' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "prints: dono troca" on storage.objects for update to authenticated
  using (bucket_id = 'screens' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'screens' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "prints: dono apaga" on storage.objects for delete to authenticated
  using (bucket_id = 'screens' and (storage.foldername(name))[1] = (select auth.uid())::text);
