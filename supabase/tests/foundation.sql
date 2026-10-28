-- Run against the configured project with a privileged SQL connection.
-- All sample records and simulated role changes are rolled back.
begin;
insert into public.reviews (id, vendor_id, display_name, product_service, experience,
  quality, value_for_money, responsiveness, production_speed, contact_name,
  contact_method, contact_details, photo_paths)
values ('10000000-0000-4000-8000-000000000001', '1', 'Phase 1 test', 'Synthetic test',
  'Disposable permission/constraint test.', 5, 4, 3, 4, 'Synthetic owner', 'email',
  'nobody@example.invalid', array['10000000-0000-4000-8000-000000000001/20000000-0000-4000-8000-000000000001.jpg']);

do $$
declare column_name text; invalid_value text; before_count bigint;
begin
  foreach column_name in array array['quality','value_for_money','responsiveness','production_speed'] loop
    foreach invalid_value in array array['null','0','6','2.5','''NaN''::numeric','''Infinity''::numeric'] loop
      begin
        execute format('update public.reviews set %I = %s where id = %L', column_name, invalid_value,
          '10000000-0000-4000-8000-000000000001');
        raise exception 'Invalid rating accepted: % = %', column_name, invalid_value;
      exception when check_violation or not_null_violation then null;
      end;
    end loop;
  end loop;
  begin
    update public.reviews set status = 'approved';
    raise exception 'Invalid status accepted';
  exception when check_violation then null; end;
  begin
    update public.reviews set contact_method = 'discord';
    raise exception 'Invalid contact method accepted';
  exception when check_violation then null; end;
  begin
    update public.reviews set photo_paths = '{}';
    raise exception 'Missing photos accepted';
  exception when check_violation then null; end;
  begin
    update public.reviews set photo_paths = array['another-review/photo.jpg'];
    raise exception 'Cross-review photo path accepted';
  exception when check_violation then null; end;
  if exists (select 1 from storage.buckets where id = 'review-photos' and public) then
    raise exception 'Photo bucket is public';
  end if;
end $$;

-- Owner UID is read from the configured helper; no real password/token involved.
select set_config('request.jwt.claim.sub', private.review_owner_id()::text, true);
set local role authenticated;
do $$ begin
  if (select count(*) from public.reviews where id = '10000000-0000-4000-8000-000000000001') <> 1 then
    raise exception 'Owner cannot read private sample';
  end if;
  update public.reviews set status = 'published' where id = '10000000-0000-4000-8000-000000000001';
  if not exists (select 1 from public.reviews where id = '10000000-0000-4000-8000-000000000001' and published_at is not null) then
    raise exception 'Owner cannot publish or timestamp trigger failed';
  end if;
  update public.reviews set status = 'pending' where id = '10000000-0000-4000-8000-000000000001';
end $$;
reset role;

select set_config('request.jwt.claim.sub', 'ffffffff-ffff-4fff-8fff-ffffffffffff', true);
set local role authenticated;
do $$ declare affected bigint; begin
  if exists (select 1 from public.reviews) then raise exception 'Non-owner can read private reviews'; end if;
  update public.reviews set owner_note = 'unauthorized';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'Non-owner can update reviews'; end if;
  delete from public.reviews;
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'Non-owner can delete reviews'; end if;
  begin
    insert into public.reviews (id, vendor_id, display_name, product_service, experience,
      quality, value_for_money, responsiveness, production_speed, contact_name,
      contact_method, contact_details, photo_paths)
    values ('10000000-0000-4000-8000-000000000002', '1', 'Unauthorized', 'Test', 'Test',
      1, 1, 1, 1, 'Test', 'email', 'nobody@example.invalid',
      array['10000000-0000-4000-8000-000000000002/20000000-0000-4000-8000-000000000002.jpg']);
    raise exception 'Non-owner can insert reviews';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

set local role anon;
do $$ begin
  begin
    perform 1 from public.reviews;
    raise exception 'Anonymous access to raw review table accepted';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'PASS: 24 rating rejection checks, invalid state/contact/photos, owner read/update, non-owner read/write/delete denial, anonymous denial; transaction rolled back' as result;
rollback;
