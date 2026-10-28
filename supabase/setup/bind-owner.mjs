// Prints non-secret SQL for an independently verified, existing Auth user ID.
// Apply the output as a separate hosted migration after provisioning that user.
const id = process.argv[2];
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id ?? '')) {
  throw new Error('Usage: node supabase/setup/bind-owner.mjs <verified-auth-user-uuid>');
}
console.log(`do $$ begin
  if not exists (select 1 from auth.users where id = '${id}'::uuid and not is_anonymous) then
    raise exception 'Owner must be an existing, non-anonymous Auth user';
  end if;
end $$;
create or replace function private.review_owner_id() returns uuid
language sql stable set search_path = '' as $$ select '${id}'::uuid $$;
revoke all on function private.review_owner_id() from public, anon;
grant execute on function private.review_owner_id() to authenticated, service_role;`);
