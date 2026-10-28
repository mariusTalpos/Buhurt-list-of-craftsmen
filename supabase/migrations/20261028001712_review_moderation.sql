-- One publication selection, without deleting the reviewer's original photos.
alter table public.reviews add column excluded_photo_paths text[] not null default '{}'
  check (coalesce(array_ndims(excluded_photo_paths), 1) = 1
    and array_position(excluded_photo_paths, null) is null
    and cardinality(excluded_photo_paths) <= 5
    and excluded_photo_paths <@ photo_paths);

-- Returns only a boolean; the same binding drives both this check and RLS.
create function public.review_owner_access() returns boolean
language sql stable security invoker set search_path = ''
as $$ select coalesce((select auth.uid()) = (select private.review_owner_id()), false) $$;
revoke all on function public.review_owner_access() from public, anon;
grant execute on function public.review_owner_access() to authenticated;
