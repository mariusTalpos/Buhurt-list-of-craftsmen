begin;
set local role service_role;
do $$ declare n integer; allowed boolean; begin
  for n in 1..11 loop
    select public.consume_review_submission_limit(repeat('a',64), 'start') into allowed;
    if allowed <> (n <= 10) then raise exception 'Rate-limit boundary failed at attempt %', n; end if;
  end loop;
end $$;
reset role;
set local role anon;
do $$ begin
  begin
    perform public.consume_review_submission_limit(repeat('b',64), 'start');
    raise exception 'Anonymous caller can consume/reset rate-limit counters';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'PASS: persistent rate limit allows 10, denies 11; anonymous RPC denied; rolled back' as result;
rollback;
