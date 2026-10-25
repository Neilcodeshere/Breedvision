-- Minimal stand-ins for the parts of the Supabase platform the migration relies
-- on, so the REAL migration can run unchanged on plain Postgres. Mirrors how
-- Supabase defines auth.uid(): it reads the JWT subject claim set per request.
create role anon nologin;
create role authenticated nologin;

create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;

create schema storage;
create table storage.buckets (
  id text primary key,
  name text,
  public boolean,
  file_size_limit bigint,
  allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text
);
create function storage.foldername(name text) returns text[] language sql immutable as
  $$ select string_to_array(regexp_replace(name, '/[^/]*$', ''), '/') $$;
alter table storage.objects enable row level security;
grant usage on schema storage to anon, authenticated;
grant select, insert, update, delete on storage.objects to authenticated;
grant execute on function storage.foldername(text) to anon, authenticated;
grant usage on schema public to anon, authenticated;
