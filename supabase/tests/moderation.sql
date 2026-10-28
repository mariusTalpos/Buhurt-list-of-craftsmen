-- Role simulation verifies exact-owner RLS without creating another Auth account.
begin;
insert into public.reviews(id,vendor_id,display_name,product_service,experience,
 quality,value_for_money,responsiveness,production_speed,contact_name,contact_method,contact_details,photo_paths)
values('30000000-0000-4000-8000-000000000001','1','Phase 3 rollback test','Synthetic item','Synthetic permission test.',
 5,4,3,4,'Test contact','email','test@example.invalid',
 array['30000000-0000-4000-8000-000000000001/40000000-0000-4000-8000-000000000001.jpg']);
select set_config('request.jwt.claim.sub', private.review_owner_id()::text, true);
set local role authenticated;
do $$ begin
  if public.review_owner_access() is not true then raise exception 'Owner access helper denied owner'; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub','ffffffff-ffff-4fff-8fff-ffffffffffff',true);
set local role authenticated;
do $$ declare affected bigint; begin
  if public.review_owner_access() is not false then raise exception 'Non-owner accepted'; end if;
  if exists(select 1 from public.reviews) then raise exception 'Non-owner can read reviews'; end if;
  if exists(select 1 from storage.objects where bucket_id='review-photos') then raise exception 'Non-owner can read photos'; end if;
  update public.reviews set status='published'; get diagnostics affected=row_count;
  if affected<>0 then raise exception 'Non-owner can approve'; end if;
  delete from public.reviews; get diagnostics affected=row_count;
  if affected<>0 then raise exception 'Non-owner can delete'; end if;
end $$;
reset role;
set local role anon;
do $$ begin
  begin
    perform public.review_owner_access(); raise exception 'Anonymous helper access accepted';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ begin
  begin
    update public.reviews set excluded_photo_paths=array['ffffffff-ffff-4fff-8fff-ffffffffffff/not-ours.jpg']
      where id='30000000-0000-4000-8000-000000000001';
    raise exception 'Foreign photo exclusion accepted';
  exception when check_violation then null; end;
end $$;
select 'PASS: owner helper, non-owner helper/read/photo/publish/delete denial, anonymous helper denial, exclusion constraint; rolled back' as result;
rollback;
