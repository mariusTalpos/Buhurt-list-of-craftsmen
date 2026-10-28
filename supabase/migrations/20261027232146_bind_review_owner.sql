do $$ begin
  if not exists (select 1 from auth.users where id = 'debb0065-2b93-449e-b6f5-f60b65e1b1ca'::uuid and not is_anonymous) then
    raise exception 'Owner must be an existing, non-anonymous Auth user';
  end if;
end $$;
create or replace function private.review_owner_id() returns uuid
language sql stable set search_path = '' as $$ select 'debb0065-2b93-449e-b6f5-f60b65e1b1ca'::uuid $$;
revoke all on function private.review_owner_id() from public, anon;
grant execute on function private.review_owner_id() to authenticated, service_role;
