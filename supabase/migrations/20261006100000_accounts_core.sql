-- Editools accounts: core schema.
--
-- Principles
--   * Row Level Security is ON for every table. Clients (the desktop app's local server, using the
--     user's JWT) can READ their own rows; every WRITE goes through a SECURITY DEFINER function or
--     an Edge Function with the service role. There is no policy that lets a client insert/update.
--   * Plan limits are rows in `plans` (editable without a release). Keys match `PlanLimits` in
--     packages/shared/src/plans.ts (camelCase); null = no plan-specific limit.
--   * The day boundary for the daily quota is America/Sao_Paulo.
--
-- Forward-only. To roll back, restore a backup taken before applying (see supabase/README.md).

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role text not null default 'user' check (role in ('user', 'admin')),
  -- null = not asked yet. Usage events are only recorded when this is true.
  consent_analytics boolean,
  created_at timestamptz not null default now()
);

-- Every new auth user gets a profile. The role is always 'user': admins are promoted by SQL
-- (supabase/scripts/promote_admin.sql), never through any API.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Plans
-- ---------------------------------------------------------------------------

create table public.plans (
  id text primary key check (id in ('free', 'pro')),
  limits jsonb not null,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

insert into public.plans (id, limits) values
  ('free', '{"dailyRuns": 10, "maxMediaSeconds": 300, "maxUploadBytes": 524288000, "maxDownloadHeight": 720, "allowedUpscaleScales": [2]}'),
  ('pro',  '{"dailyRuns": null, "maxMediaSeconds": null, "maxUploadBytes": null, "maxDownloadHeight": null, "allowedUpscaleScales": null}');

-- ---------------------------------------------------------------------------
-- Subscriptions
-- ---------------------------------------------------------------------------

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  plan_id text not null references public.plans (id),
  status text not null check (status in ('active', 'past_due', 'canceled', 'refunded', 'chargeback')),
  -- Paid access ends here (grace included). null = no expiry, used only by admin overrides.
  access_until timestamptz,
  source text not null check (source in ('kiwify', 'admin_override')),
  kiwify_order_id text,
  kiwify_product_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index subscriptions_user_idx on public.subscriptions (user_id);
create unique index subscriptions_kiwify_order_uidx on public.subscriptions (kiwify_order_id)
  where kiwify_order_id is not null;

-- A purchase made before the buyer has an account. Keyed by normalised e-mail and attached on the
-- first verified sign-in (claim_pending_entitlements).
create table public.pending_entitlements (
  id uuid primary key default gen_random_uuid(),
  email_norm text not null,
  plan_id text not null references public.plans (id),
  status text not null check (status in ('active', 'past_due', 'canceled', 'refunded', 'chargeback')),
  access_until timestamptz,
  source text not null default 'kiwify' check (source in ('kiwify', 'admin_override')),
  kiwify_order_id text,
  kiwify_product_id text,
  created_at timestamptz not null default now(),
  claimed_at timestamptz
);

create index pending_entitlements_email_idx on public.pending_entitlements (email_norm) where claimed_at is null;
create unique index pending_entitlements_order_uidx on public.pending_entitlements (kiwify_order_id)
  where kiwify_order_id is not null;

-- Raw log of every Kiwify webhook delivery (written by the kiwify-webhook Edge Function).
create table public.kiwify_events (
  id uuid primary key default gen_random_uuid(),
  received_at timestamptz not null default now(),
  idem_key text not null unique,
  webhook_event_type text,
  order_id text,
  signature_ok boolean not null default false,
  signature_mode text check (signature_mode in ('raw', 'canonical')),
  payload jsonb not null,
  processed_at timestamptz,
  error text
);

-- ---------------------------------------------------------------------------
-- Usage (daily quota)
-- ---------------------------------------------------------------------------

create table public.usage_counters (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  count integer not null default 0 check (count >= 0),
  primary key (user_id, day)
);

create table public.usage_reservations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  tool text not null,
  day date not null,
  status text not null default 'reserved' check (status in ('reserved', 'released')),
  created_at timestamptz not null default now()
);

create index usage_reservations_user_day_idx on public.usage_reservations (user_id, day);

-- ---------------------------------------------------------------------------
-- Analytics events and the admin audit trail
-- ---------------------------------------------------------------------------

-- No FK to auth.users on purpose: deleting an account anonymises its events (user_id -> null)
-- instead of cascading, so aggregate statistics survive.
create table public.events (
  id bigint generated always as identity primary key,
  ts timestamptz not null default now(),
  user_id uuid,
  device_id text,
  session_id text,
  name text not null,
  tool text,
  props jsonb not null default '{}'::jsonb,
  app_version text,
  os text
);

create index events_ts_brin on public.events using brin (ts);
create index events_name_ts_idx on public.events (name, ts);
create index events_user_ts_idx on public.events (user_id, ts);
create index events_tool_ts_idx on public.events (tool, ts);

create table public.admin_audit (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  admin_id uuid not null,
  action text not null,
  target uuid,
  details jsonb not null default '{}'::jsonb
);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.plans enable row level security;
alter table public.subscriptions enable row level security;
alter table public.pending_entitlements enable row level security;
alter table public.kiwify_events enable row level security;
alter table public.usage_counters enable row level security;
alter table public.usage_reservations enable row level security;
alter table public.events enable row level security;
alter table public.admin_audit enable row level security;

-- Read-only for the owner. No insert/update/delete policy exists for any role, so every write is a
-- SECURITY DEFINER function or the service role. `role` and consent can therefore never be edited
-- directly by the user (consent goes through set_consent()).
create policy profiles_select_own on public.profiles for select to authenticated using (id = auth.uid());
create policy subscriptions_select_own on public.subscriptions for select to authenticated using (user_id = auth.uid());
create policy usage_counters_select_own on public.usage_counters for select to authenticated using (user_id = auth.uid());
create policy usage_reservations_select_own on public.usage_reservations for select to authenticated using (user_id = auth.uid());
create policy plans_select_all on public.plans for select to authenticated using (true);
-- pending_entitlements, kiwify_events, events, admin_audit: RLS on and no policy = no client access.

-- Defence in depth: the API roles get no table privileges beyond what the policies allow to read.
revoke all on all tables in schema public from anon, authenticated;
grant select on public.profiles, public.plans, public.subscriptions, public.usage_counters, public.usage_reservations
  to authenticated;
