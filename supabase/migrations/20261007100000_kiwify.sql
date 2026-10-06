-- Kiwify integration: the two database functions the kiwify-webhook Edge Function calls.
--
-- Both are reachable ONLY with the service-role key (revoked from everyone else). The subscription
-- key is Kiwify's subscription id when the payload has one, else the order id; it is stored in
-- `kiwify_order_id`, which already has a unique index on subscriptions and pending_entitlements.

-- Current stored state for a key, from whichever table holds it. Used to compute the next state.
create function public.kiwify_get_state(p_key text)
returns table (status text, access_until timestamptz, updated_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  (select s.status, s.access_until, s.updated_at from public.subscriptions s where s.kiwify_order_id = p_key)
  union all
  (select e.status, e.access_until, e.created_at from public.pending_entitlements e
    where e.kiwify_order_id = p_key and e.claimed_at is null)
  limit 1
$$;

-- Applies one computed state. The buyer is matched by VERIFIED e-mail only: an unconfirmed address
-- never receives a purchase. Without a matching user the purchase waits in pending_entitlements and
-- is attached at the first sign-in (claim_pending_entitlements).
-- Returns 'subscription' or 'pending'.
create function public.kiwify_apply(
  p_key text,
  p_email text,
  p_product text,
  p_plan text,
  p_status text,
  p_access_until timestamptz
) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_email text := lower(btrim(p_email));
  v_user uuid;
begin
  if p_key is null or v_email is null or p_status not in ('active', 'past_due', 'canceled', 'refunded', 'chargeback') then
    raise exception 'invalid arguments' using errcode = '22023';
  end if;
  if not exists (select 1 from public.plans where id = p_plan and active) then
    raise exception 'unknown plan' using errcode = '22023';
  end if;

  select u.id into v_user
  from auth.users u
  where lower(btrim(u.email)) = v_email and u.email_confirmed_at is not null
  limit 1;

  -- One writer per key at a time, so two events for the same subscription cannot interleave.
  perform pg_advisory_xact_lock(hashtextextended('kiwify:' || p_key, 0));

  if v_user is not null then
    insert into public.subscriptions (user_id, plan_id, status, access_until, source, kiwify_order_id, kiwify_product_id)
    values (v_user, p_plan, p_status, p_access_until, 'kiwify', p_key, p_product)
    on conflict (kiwify_order_id) where kiwify_order_id is not null
    do update set status = excluded.status, access_until = excluded.access_until,
                  plan_id = excluded.plan_id, kiwify_product_id = excluded.kiwify_product_id,
                  updated_at = now();
    -- A purchase that was waiting for this person is now settled.
    update public.pending_entitlements set claimed_at = now()
      where kiwify_order_id = p_key and claimed_at is null;
    return 'subscription';
  end if;

  insert into public.pending_entitlements (email_norm, plan_id, status, access_until, source, kiwify_order_id, kiwify_product_id)
  values (v_email, p_plan, p_status, p_access_until, 'kiwify', p_key, p_product)
  on conflict (kiwify_order_id) where kiwify_order_id is not null
  do update set status = excluded.status, access_until = excluded.access_until,
                plan_id = excluded.plan_id, kiwify_product_id = excluded.kiwify_product_id,
                email_norm = excluded.email_norm, claimed_at = null;
  return 'pending';
end;
$$;

revoke all on function public.kiwify_get_state(text) from public, anon, authenticated;
revoke all on function public.kiwify_apply(text, text, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.kiwify_get_state(text) to service_role;
grant execute on function public.kiwify_apply(text, text, text, text, text, timestamptz) to service_role;
