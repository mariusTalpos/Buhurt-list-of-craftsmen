-- Internal abuse counters, not reviewer accounts or order tracking.
create table private.review_submission_limits (
  key text primary key check (key ~ '^[0-9a-f]{64}$'),
  scope text not null check (scope in ('start', 'photo', 'finish', 'cancel')),
  attempts integer not null check (attempts >= 1),
  expires_at timestamptz not null
);
alter table private.review_submission_limits enable row level security;
revoke all on private.review_submission_limits from public, anon, authenticated;
grant select, insert, update, delete on private.review_submission_limits to service_role;
create index review_submission_limits_expiry on private.review_submission_limits(expires_at);

create function public.consume_review_submission_limit(p_key text, p_scope text)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare n integer; max_attempts integer;
begin
  max_attempts := case p_scope when 'start' then 10 when 'photo' then 50 when 'finish' then 30 when 'cancel' then 20 end;
  if max_attempts is null or p_key !~ '^[0-9a-f]{64}$' then return false; end if;
  -- Opportunistic expiry; no scheduled job or review-retention workflow.
  delete from private.review_submission_limits where expires_at < now();
  insert into private.review_submission_limits as limits(key, scope, attempts, expires_at)
  values(p_key, p_scope, 1, now() + interval '1 hour')
  on conflict(key) do update set attempts = least(limits.attempts + 1, 1000)
  returning attempts into n;
  return n <= max_attempts;
end $$;
revoke all on function public.consume_review_submission_limit(text, text) from public, anon, authenticated;
grant execute on function public.consume_review_submission_limit(text, text) to service_role;
