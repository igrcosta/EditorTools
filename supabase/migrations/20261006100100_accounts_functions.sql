-- Editools accounts: functions.
--
-- Every function that touches user data is SECURITY DEFINER with a pinned search_path and derives
-- the user ONLY from auth.uid() (never from an argument), so a caller can only ever act on itself.
-- Execution is revoked from PUBLIC/anon and granted to `authenticated` one function at a time.

-- ---------------------------------------------------------------------------
-- Helpers (not callable by clients)
-- ---------------------------------------------------------------------------

-- Day boundary of the daily quota.
create function public.sao_paulo_today() returns date
language sql stable set search_path = pg_catalog as $$
  select (now() at time zone 'America/Sao_Paulo')::date
$$;

create function public.next_quota_reset() returns timestamptz
language sql stable set search_path = public, pg_temp as $$
  select ((public.sao_paulo_today() + 1)::timestamp at time zone 'America/Sao_Paulo')
$$;

-- The role is read from the table, never from a JWT claim the client could influence.
create function public.is_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select p.role = 'admin' from public.profiles p where p.id = auth.uid()), false)
$$;

-- The subscription that currently grants access, if any. Expiry is enforced here on every call, so
-- it never depends on a scheduled job having run. A canceled subscription keeps access until the
-- end of the period it paid for.
create function public.effective_subscription(p_user uuid)
returns table (plan_id text, status text, access_until timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select s.plan_id, s.status, s.access_until
  from public.subscriptions s
  where s.user_id = p_user
    and s.status in ('active', 'past_due', 'canceled')
    and (s.access_until is null or s.access_until > now())
    and exists (select 1 from public.plans p where p.id = s.plan_id and p.active)
  order by case s.plan_id when 'pro' then 0 else 1 end, s.access_until desc nulls first, s.updated_at desc
  limit 1
$$;

create function public.plan_limits(p_plan text) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    (select p.limits from public.plans p where p.id = p_plan),
    (select p.limits from public.plans p where p.id = 'free')
  )
$$;

-- ---------------------------------------------------------------------------
-- Client-callable functions
-- ---------------------------------------------------------------------------

-- Everything the app needs to know about the signed-in account. Shape = `Entitlements` in
-- packages/shared/src/plans.ts.
create function public.get_entitlements() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  uid uuid := auth.uid();
  sub record;
  prof record;
  v_plan text := 'free';
  v_status text := 'none';
  v_until timestamptz := null;
  v_limits jsonb;
  v_limit integer;
  v_used integer;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select * into sub from public.effective_subscription(uid);
  if found then
    v_plan := sub.plan_id;
    v_status := sub.status;
    v_until := sub.access_until;
  end if;

  v_limits := public.plan_limits(v_plan);
  v_limit := nullif(v_limits ->> 'dailyRuns', '')::integer;

  select c.count into v_used from public.usage_counters c where c.user_id = uid and c.day = public.sao_paulo_today();
  v_used := coalesce(v_used, 0);

  select p.role, p.consent_analytics into prof from public.profiles p where p.id = uid;

  return jsonb_build_object(
    'plan', v_plan,
    'status', v_status,
    'accessUntil', v_until,
    'limits', v_limits,
    'quota', jsonb_build_object('used', v_used, 'limit', v_limit, 'resetsAt', public.next_quota_reset()),
    'role', coalesce(prof.role, 'user'),
    'consentAnalytics', coalesce(prof.consent_analytics, false),
    'consentAnswered', prof.consent_analytics is not null
  );
end;
$$;

-- Atomically takes one run of today's quota BEFORE a job starts. The advisory lock serialises a
-- user's calls, so two parallel requests at "limit minus one" cannot both succeed. The tool list
-- must match COUNTED_TOOLS in packages/shared/src/plans.ts (a unit test compares them).
create function public.reserve_run(p_tool text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := auth.uid();
  v_day date := public.sao_paulo_today();
  counted text[] := array['download', 'convert', 'audio_fix', 'silence_cut', 'remove_background', 'upscale', 'face_track', 'captions_render'];
  sub record;
  v_plan text := 'free';
  v_limit integer;
  v_count integer;
  v_id uuid;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_tool is null or not (p_tool = any (counted)) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_tool');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(uid::text, 0));

  select * into sub from public.effective_subscription(uid);
  if found then
    v_plan := sub.plan_id;
  end if;
  v_limit := nullif(public.plan_limits(v_plan) ->> 'dailyRuns', '')::integer;

  insert into public.usage_counters (user_id, day, count) values (uid, v_day, 0) on conflict do nothing;
  select c.count into v_count from public.usage_counters c where c.user_id = uid and c.day = v_day for update;

  if v_limit is not null and v_count >= v_limit then
    return jsonb_build_object(
      'ok', false, 'reason', 'quota_exceeded', 'used', v_count, 'limit', v_limit,
      'remaining', 0, 'resetsAt', public.next_quota_reset()
    );
  end if;

  update public.usage_counters set count = count + 1 where user_id = uid and day = v_day;
  insert into public.usage_reservations (user_id, tool, day) values (uid, p_tool, v_day) returning id into v_id;

  return jsonb_build_object(
    'ok', true, 'reservationId', v_id, 'used', v_count + 1, 'limit', v_limit,
    'remaining', case when v_limit is null then null else v_limit - v_count - 1 end,
    'resetsAt', public.next_quota_reset()
  );
end;
$$;

-- Gives a run back (the job failed, was canceled, or never started). Idempotent: a second call, or
-- a call for someone else's reservation, does nothing and returns false.
create function public.release_run(p_id uuid) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := auth.uid();
  r record;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(uid::text, 0));

  select * into r from public.usage_reservations
    where id = p_id and user_id = uid and status = 'reserved' for update;
  if not found then
    return false;
  end if;

  update public.usage_reservations set status = 'released' where id = r.id;
  update public.usage_counters set count = greatest(count - 1, 0) where user_id = uid and day = r.day;
  return true;
end;
$$;

-- Attaches purchases made before the account existed. Matches on the e-mail of the signed-in user,
-- and only if Supabase has verified that address (the sign-in code proves ownership).
create function public.claim_pending_entitlements() returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := auth.uid();
  v_email text;
  v_claimed integer := 0;
  r record;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select lower(btrim(u.email)) into v_email from auth.users u where u.id = uid and u.email_confirmed_at is not null;
  if v_email is null then
    return 0;
  end if;

  for r in
    select * from public.pending_entitlements
    where email_norm = v_email and claimed_at is null
    order by created_at
    for update skip locked
  loop
    insert into public.subscriptions (user_id, plan_id, status, access_until, source, kiwify_order_id, kiwify_product_id)
    values (uid, r.plan_id, r.status, r.access_until, r.source, r.kiwify_order_id, r.kiwify_product_id)
    on conflict (kiwify_order_id) where kiwify_order_id is not null do nothing;

    update public.pending_entitlements set claimed_at = now() where id = r.id;
    v_claimed := v_claimed + 1;
  end loop;

  return v_claimed;
end;
$$;

-- The user's answer to the analytics notice. The only profile column a user can change, and only
-- through this function.
create function public.set_consent(p_value boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  update public.profiles set consent_analytics = p_value where id = uid;
end;
$$;

-- LGPD data export: everything stored about the caller, as one JSON document.
create function public.export_my_data() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  return jsonb_build_object(
    'exportedAt', now(),
    'profile', (select to_jsonb(p) from public.profiles p where p.id = uid),
    'subscriptions', coalesce((select jsonb_agg(to_jsonb(s) order by s.created_at) from public.subscriptions s where s.user_id = uid), '[]'::jsonb),
    'usageCounters', coalesce((select jsonb_agg(to_jsonb(c) order by c.day) from public.usage_counters c where c.user_id = uid), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(to_jsonb(e) - 'id' order by e.ts) from public.events e where e.user_id = uid), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin (dev tools). Each checks the role in the database and writes the audit trail.
-- They act on the caller's own account only.
-- ---------------------------------------------------------------------------

create function public.admin_set_own_plan(p_plan text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := auth.uid();
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_plan is null or p_plan not in ('free', 'pro') then
    raise exception 'invalid plan' using errcode = '22023';
  end if;

  delete from public.subscriptions where user_id = uid and source = 'admin_override';
  if p_plan = 'pro' then
    insert into public.subscriptions (user_id, plan_id, status, access_until, source)
    values (uid, 'pro', 'active', null, 'admin_override');
  end if;

  insert into public.admin_audit (admin_id, action, target, details)
  values (uid, 'set_own_plan', uid, jsonb_build_object('plan', p_plan));

  return public.get_entitlements();
end;
$$;

create function public.admin_reset_own_quota() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := auth.uid();
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  delete from public.usage_counters where user_id = uid and day = public.sao_paulo_today();
  update public.usage_reservations set status = 'released'
    where user_id = uid and day = public.sao_paulo_today() and status = 'reserved';

  insert into public.admin_audit (admin_id, action, target) values (uid, 'reset_own_quota', uid);
  return public.get_entitlements();
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

revoke all on function
  public.handle_new_user(), public.sao_paulo_today(), public.next_quota_reset(), public.is_admin(),
  public.effective_subscription(uuid), public.plan_limits(text),
  public.get_entitlements(), public.reserve_run(text), public.release_run(uuid),
  public.claim_pending_entitlements(), public.set_consent(boolean), public.export_my_data(),
  public.admin_set_own_plan(text), public.admin_reset_own_quota()
  from public, anon, authenticated;

grant execute on function
  public.get_entitlements(), public.reserve_run(text), public.release_run(uuid),
  public.claim_pending_entitlements(), public.set_consent(boolean), public.export_my_data(),
  public.admin_set_own_plan(text), public.admin_reset_own_quota()
  to authenticated;
