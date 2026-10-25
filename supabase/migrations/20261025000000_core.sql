-- BreedVision: core schema.
--
-- Security model: every table is protected by row-level security so a user can
-- only ever read or change their own rows. This is enforced here, in the
-- database, not in application code, so a bug or a hostile client in the app
-- cannot widen access. The browser only ever holds the public (anon /
-- publishable) key; the service-role key must never reach the frontend.
--
-- Tested against a real Postgres in supabase/tests (rls.test.mjs).

-- ---------------------------------------------------------------------------
-- identification_records
-- ---------------------------------------------------------------------------
create table if not exists public.identification_records (
  -- Generated on the client, so a retried upload is idempotent.
  id                 uuid primary key,
  user_id            uuid not null default auth.uid()
                       references auth.users (id) on delete cascade,
  created_at         timestamptz not null,
  breed_id           text not null check (char_length(breed_id) between 1 and 80),
  breed_name         text not null check (char_length(breed_name) between 1 and 120),
  confidence         real not null check (confidence >= 0 and confidence <= 1),
  band               text not null check (band in ('confident', 'uncertain', 'low')),
  alternatives       jsonb not null default '[]'::jsonb
                       check (jsonb_typeof(alternatives) = 'array'),
  model_version      text not null check (char_length(model_version) between 1 and 200),
  latitude           double precision check (latitude between -90 and 90),
  longitude          double precision check (longitude between -180 and 180),
  accuracy_m         integer check (accuracy_m >= 0),
  note               text check (char_length(note) <= 1000),
  -- Path inside the private 'record-images' bucket: '<user_id>/<record_id>.jpg'
  image_path         text,
  image_width        integer check (image_width > 0),
  image_height       integer check (image_height > 0),
  -- 64-bit perceptual hash as 16 lowercase hex characters.
  phash              text check (phash ~ '^[0-9a-f]{16}$'),
  duplicate_of       uuid references public.identification_records (id) on delete set null,
  duplicate_distance smallint check (duplicate_distance between 0 and 64),
  duplicate_tier     text check (duplicate_tier in ('same', 'similar')),
  synced_at          timestamptz not null default now(),
  -- A location is a pair or nothing; half a coordinate is meaningless.
  constraint location_is_a_pair check ((latitude is null) = (longitude is null))
);

create index if not exists identification_records_user_created_idx
  on public.identification_records (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- sale_logs: real, user-entered sale prices only.
-- ---------------------------------------------------------------------------
create table if not exists public.sale_logs (
  id                 uuid primary key,
  user_id            uuid not null default auth.uid()
                       references auth.users (id) on delete cascade,
  breed_id           text not null check (char_length(breed_id) between 1 and 80),
  breed_name         text not null check (char_length(breed_name) between 1 and 120),
  price_inr          integer not null check (price_inr between 1000 and 1000000),
  sold_on            date not null check (sold_on <= current_date),
  milk_yield_litres  real check (milk_yield_litres between 0 and 60),
  pregnant           boolean,
  age_years          real check (age_years between 0 and 30),
  note               text check (char_length(note) <= 1000),
  -- Synthetic demo rows must never reach the shared database, where they would
  -- be indistinguishable from evidence. Enforced here, not just in the client.
  source             text not null default 'user' check (source = 'user'),
  created_at         timestamptz not null default now()
);

create index if not exists sale_logs_user_sold_idx
  on public.sale_logs (user_id, sold_on desc);

-- ---------------------------------------------------------------------------
-- Row-level security: owner only.
-- ---------------------------------------------------------------------------
alter table public.identification_records enable row level security;
alter table public.sale_logs enable row level security;

drop policy if exists "owner select" on public.identification_records;
drop policy if exists "owner insert" on public.identification_records;
drop policy if exists "owner update" on public.identification_records;
drop policy if exists "owner delete" on public.identification_records;
create policy "owner select" on public.identification_records
  for select to authenticated using (user_id = (select auth.uid()));
create policy "owner insert" on public.identification_records
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "owner update" on public.identification_records
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "owner delete" on public.identification_records
  for delete to authenticated using (user_id = (select auth.uid()));

drop policy if exists "owner select" on public.sale_logs;
drop policy if exists "owner insert" on public.sale_logs;
drop policy if exists "owner update" on public.sale_logs;
drop policy if exists "owner delete" on public.sale_logs;
create policy "owner select" on public.sale_logs
  for select to authenticated using (user_id = (select auth.uid()));
create policy "owner insert" on public.sale_logs
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "owner update" on public.sale_logs
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "owner delete" on public.sale_logs
  for delete to authenticated using (user_id = (select auth.uid()));

-- Anonymous visitors get nothing. Grants are explicit rather than relying on
-- platform defaults.
revoke all on public.identification_records from anon;
revoke all on public.sale_logs from anon;
grant select, insert, update, delete on public.identification_records to authenticated;
grant select, insert, update, delete on public.sale_logs to authenticated;

-- ---------------------------------------------------------------------------
-- Cross-user duplicate-photo check.
--
-- Row-level security hides other users' records, which is right, but it also
-- means a per-device check cannot notice a photo already submitted from another
-- account. This function closes that gap while revealing as little as possible:
-- it returns only the Hamming distance and a tier. It never returns a record id,
-- an owner, an image path, a location, or (for someone else's record) a date.
--
-- It compares photographs, not animals, and misses cropped or rotated copies.
-- Thresholds (<=4 same, <=8 similar) are measured in docs/duplicate-detection.md.
-- ---------------------------------------------------------------------------
create or replace function public.hash_distance(a text, b text)
returns integer
language sql
immutable
parallel safe
as $$
  select bit_count((('x' || a)::bit(64)) # (('x' || b)::bit(64)))::integer;
$$;

create or replace function public.check_duplicate_photo(p_hash text, p_mirror text)
returns table (distance integer, tier text, is_own boolean, recorded_on date)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if p_hash !~ '^[0-9a-f]{16}$' or p_mirror !~ '^[0-9a-f]{16}$' then
    raise exception 'hash must be 16 lowercase hex characters' using errcode = '22023';
  end if;

  return query
    select
      d.dist,
      case when d.dist <= 4 then 'same' else 'similar' end,
      (r.user_id = auth.uid()),
      case when r.user_id = auth.uid() then r.created_at::date else null end
    from public.identification_records r
    cross join lateral (
      select least(public.hash_distance(p_hash, r.phash),
                   public.hash_distance(p_mirror, r.phash)) as dist
    ) d
    where r.phash is not null and d.dist <= 8
    order by d.dist asc, (r.user_id = auth.uid()) desc, r.created_at asc
    limit 1;
end;
$$;

revoke all on function public.check_duplicate_photo(text, text) from public;
revoke all on function public.check_duplicate_photo(text, text) from anon;
grant execute on function public.check_duplicate_photo(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Private image bucket, one folder per user.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('record-images', 'record-images', false, 5242880,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "own images select" on storage.objects;
drop policy if exists "own images insert" on storage.objects;
drop policy if exists "own images update" on storage.objects;
drop policy if exists "own images delete" on storage.objects;
create policy "own images select" on storage.objects
  for select to authenticated
  using (bucket_id = 'record-images'
         and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "own images insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'record-images'
              and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "own images update" on storage.objects
  for update to authenticated
  using (bucket_id = 'record-images'
         and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'record-images'
              and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "own images delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'record-images'
         and (storage.foldername(name))[1] = (select auth.uid())::text);
