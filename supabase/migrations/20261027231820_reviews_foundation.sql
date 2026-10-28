-- Phase 1 only: no anonymous submission or publication API is created here.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- Fail closed until setup/bind-owner.mjs generates the owner binding.
-- This is an exact Auth user UUID, never user-editable profile metadata.
create function private.review_owner_id() returns uuid
language sql stable set search_path = ''
as $$ select null::uuid $$;
revoke all on function private.review_owner_id() from public, anon;
grant execute on function private.review_owner_id() to authenticated, service_role;

create function private.valid_review_photos(review_id uuid, paths text[])
returns boolean language sql immutable set search_path = ''
as $$
  select coalesce(
    cardinality(paths) between 1 and 5
    and array_ndims(paths) = 1
    and array_position(paths, null) is null
    and cardinality(paths) = (select count(distinct p) from unnest(paths) p)
    and not exists (
      select 1 from unnest(paths) p
      where p !~ ('^' || review_id::text || '/[0-9a-f-]{36}\.(jpg|webp)$')
    ), false);
$$;
revoke all on function private.valid_review_photos(uuid, text[]) from public, anon;
grant execute on function private.valid_review_photos(uuid, text[]) to authenticated, service_role;

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  vendor_id text not null check (vendor_id ~ '^[0-9]+$'),
  status text not null default 'pending' check (status in ('pending', 'published')),
  display_name text not null check (length(btrim(display_name)) between 1 and 80),
  product_service text not null check (length(btrim(product_service)) between 1 and 200),
  experience text not null check (length(btrim(experience)) between 1 and 5000),
  -- NUMERIC plus checks rejects fractions; integer column casts would round 2.5.
  quality numeric not null check (quality between 1 and 5 and quality = trunc(quality)),
  value_for_money numeric not null check (value_for_money between 1 and 5 and value_for_money = trunc(value_for_money)),
  responsiveness numeric not null check (responsiveness between 1 and 5 and responsiveness = trunc(responsiveness)),
  production_speed numeric not null check (production_speed between 1 and 5 and production_speed = trunc(production_speed)),
  contact_name text not null check (length(btrim(contact_name)) between 1 and 120),
  contact_method text not null check (contact_method in ('facebook', 'instagram', 'whatsapp', 'phone', 'email')),
  contact_details text not null check (length(btrim(contact_details)) between 1 and 500),
  owner_note text not null default '' check (length(owner_note) <= 5000),
  photo_paths text[] not null check (private.valid_review_photos(id, photo_paths)),
  photos_public boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  constraint reviews_publication_timestamp check ((status = 'published') = (published_at is not null))
);
comment on table public.reviews is 'Private source records. Public responses must explicitly select approved public fields.';
create index reviews_vendor_status on public.reviews (vendor_id, status, published_at desc);

create function private.stamp_review() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' then
    new.id := old.id;
    new.created_at := old.created_at;
  else
    new.created_at := now();
  end if;
  if new.status = 'published' then
    if tg_op = 'INSERT' then
      new.published_at := now();
    elsif old.status <> 'published' then
      new.published_at := now();
    else
      new.published_at := old.published_at;
    end if;
  else
    new.published_at := null;
  end if;
  return new;
end;
$$;
revoke all on function private.stamp_review() from public, anon;
create trigger reviews_stamp before insert or update on public.reviews
for each row execute function private.stamp_review();

alter table public.reviews enable row level security;
revoke all on public.reviews from public, anon, authenticated;
grant select, insert, update, delete on public.reviews to authenticated;
grant all on public.reviews to service_role;
create policy reviews_owner_select on public.reviews for select to authenticated
using ((select auth.uid()) = (select private.review_owner_id()));
create policy reviews_owner_insert on public.reviews for insert to authenticated
with check ((select auth.uid()) = (select private.review_owner_id()));
create policy reviews_owner_update on public.reviews for update to authenticated
using ((select auth.uid()) = (select private.review_owner_id()))
with check ((select auth.uid()) = (select private.review_owner_id()));
create policy reviews_owner_delete on public.reviews for delete to authenticated
using ((select auth.uid()) = (select private.review_owner_id()));

-- Only processed output is accepted. Original HEIC/JPEG files stay in the browser.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('review-photos', 'review-photos', false, 10485760, array['image/jpeg', 'image/webp']);
create policy review_photos_owner_select on storage.objects for select to authenticated
using (bucket_id = 'review-photos' and (select auth.uid()) = (select private.review_owner_id()));
create policy review_photos_owner_insert on storage.objects for insert to authenticated
with check (bucket_id = 'review-photos' and (select auth.uid()) = (select private.review_owner_id()));
create policy review_photos_owner_update on storage.objects for update to authenticated
using (bucket_id = 'review-photos' and (select auth.uid()) = (select private.review_owner_id()))
with check (bucket_id = 'review-photos' and (select auth.uid()) = (select private.review_owner_id()));
create policy review_photos_owner_delete on storage.objects for delete to authenticated
using (bucket_id = 'review-photos' and (select auth.uid()) = (select private.review_owner_id()));
