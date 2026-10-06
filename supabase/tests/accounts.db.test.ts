import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { COUNTED_TOOLS, DEFAULT_PLAN_LIMITS } from '../../packages/shared/src/plans';

/**
 * Runs the real migrations in an in-process Postgres (PGlite) with a minimal stand-in for the
 * Supabase `auth` schema, so the quota, entitlement and access rules are exercised for real.
 *
 * What this does NOT cover: true parallelism (PGlite is a single connection, so the advisory lock
 * is not stress-tested), GoTrue itself, pg_cron, and Supabase's own role/grant defaults. Those need
 * `supabase start` + `supabase test db`, which require Docker.
 */

const MIGRATIONS = path.resolve(__dirname, '../migrations');

const BOOT = `
create role anon nologin;
create role authenticated nologin;
create schema auth;
-- Only the columns the migrations and seed.sql touch (GoTrue's real table has many more).
create table auth.users (
  instance_id uuid,
  id uuid primary key default gen_random_uuid(),
  aud text,
  role text,
  email text,
  encrypted_password text,
  email_confirmed_at timestamptz,
  raw_app_meta_data jsonb,
  raw_user_meta_data jsonb,
  created_at timestamptz,
  updated_at timestamptz,
  confirmation_token text,
  recovery_token text,
  email_change_token_new text,
  email_change text
);
create table auth.identities (
  id uuid primary key,
  user_id uuid,
  provider_id text,
  identity_data jsonb,
  provider text,
  last_sign_in_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
);
-- Same definition as Supabase's auth.uid().
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
grant usage on schema public to anon, authenticated;
`;

let db: PGlite;

async function newUser(email: string, confirmed = true): Promise<string> {
  const r = await db.query<{ id: string }>(
    `insert into auth.users (email, email_confirmed_at) values ($1, ${confirmed ? 'now()' : 'null'}) returning id`,
    [email],
  );
  return r.rows[0].id;
}

/** Runs `fn` as the signed-in `authenticated` role for this user, then goes back to superuser. */
async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: userId })]);
  await db.exec('set role authenticated');
  try {
    return await fn();
  } finally {
    await db.exec('reset role');
    await db.query(`select set_config('request.jwt.claims', '', false)`);
  }
}

const rpc = async (fn: string, ...args: unknown[]) => {
  const placeholders = args.map((_, i) => `$${i + 1}`).join(', ');
  const r = await db.query<{ v: unknown }>(`select public.${fn}(${placeholders}) as v`, args);
  return r.rows[0].v as any;
};

beforeAll(async () => {
  db = new PGlite();
  await db.exec(BOOT);
  for (const file of readdirSync(MIGRATIONS).sort()) {
    await db.exec(readFileSync(path.join(MIGRATIONS, file), 'utf8'));
  }
});

afterAll(async () => {
  await db.close();
});

describe('schema stays in step with the shared rules', () => {
  it('seeds the same plan limits as DEFAULT_PLAN_LIMITS', async () => {
    const r = await db.query<{ id: string; limits: unknown }>('select id, limits from public.plans order by id');
    const byId = Object.fromEntries(r.rows.map((row) => [row.id, row.limits]));
    expect(byId.free).toEqual(DEFAULT_PLAN_LIMITS.free);
    expect(byId.pro).toEqual(DEFAULT_PLAN_LIMITS.pro);
  });

  it('counts exactly the tools COUNTED_TOOLS lists', () => {
    const sql = readFileSync(path.join(MIGRATIONS, '20261006100100_accounts_functions.sql'), 'utf8');
    const list = /counted text\[\] := array\[([^\]]+)\]/.exec(sql)?.[1] ?? '';
    const tools = [...list.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(new Set(tools)).toEqual(new Set(COUNTED_TOOLS));
  });
});

describe('profiles and entitlements', () => {
  it('creates a profile with role user for every new auth user', async () => {
    const id = await newUser('profile@test.dev');
    const r = await db.query<{ role: string; consent_analytics: boolean | null }>(
      'select role, consent_analytics from public.profiles where id = $1',
      [id],
    );
    expect(r.rows).toEqual([{ role: 'user', consent_analytics: null }]);
  });

  it('describes a fresh account as free, unlimited-in-time, with a full quota', async () => {
    const id = await newUser('fresh@test.dev');
    const e = await asUser(id, () => rpc('get_entitlements'));
    expect(e).toMatchObject({
      plan: 'free',
      status: 'none',
      accessUntil: null,
      limits: DEFAULT_PLAN_LIMITS.free,
      quota: { used: 0, limit: 10 },
      role: 'user',
      consentAnalytics: false,
      consentAnswered: false,
    });
    expect(new Date(e.quota.resetsAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('refuses callers that are not signed in', async () => {
    await expect(rpc('get_entitlements')).rejects.toThrow(/not authenticated/);
    await expect(rpc('reserve_run', 'convert')).rejects.toThrow(/not authenticated/);
  });
});

describe('daily quota (reserve_run / release_run)', () => {
  it('lets a free user make 10 runs, then blocks the 11th', async () => {
    const id = await newUser('quota@test.dev');
    await asUser(id, async () => {
      for (let i = 1; i <= 10; i += 1) {
        const r = await rpc('reserve_run', 'convert');
        expect(r).toMatchObject({ ok: true, used: i, limit: 10, remaining: 10 - i });
        expect(r.reservationId).toBeTruthy();
      }
      const blocked = await rpc('reserve_run', 'convert');
      expect(blocked).toMatchObject({ ok: false, reason: 'quota_exceeded', used: 10, limit: 10, remaining: 0 });
      expect((await rpc('get_entitlements')).quota.used).toBe(10);
    });
  });

  it('gives a run back on release, exactly once', async () => {
    const id = await newUser('release@test.dev');
    await asUser(id, async () => {
      const a = await rpc('reserve_run', 'upscale');
      await rpc('reserve_run', 'upscale');
      expect((await rpc('get_entitlements')).quota.used).toBe(2);

      expect(await rpc('release_run', a.reservationId)).toBe(true);
      expect((await rpc('get_entitlements')).quota.used).toBe(1);
      expect(await rpc('release_run', a.reservationId)).toBe(false); // idempotent
      expect((await rpc('get_entitlements')).quota.used).toBe(1);
    });
  });

  it('does not let one user release another user\'s reservation', async () => {
    const owner = await newUser('owner@test.dev');
    const other = await newUser('other@test.dev');
    const reservation = await asUser(owner, () => rpc('reserve_run', 'face_track'));
    expect(await asUser(other, () => rpc('release_run', reservation.reservationId))).toBe(false);
    expect((await asUser(owner, () => rpc('get_entitlements'))).quota.used).toBe(1);
  });

  it('frees the quota again after releasing at the limit', async () => {
    const id = await newUser('atlimit@test.dev');
    await asUser(id, async () => {
      let last: any;
      for (let i = 0; i < 10; i += 1) last = await rpc('reserve_run', 'convert');
      expect((await rpc('reserve_run', 'convert')).ok).toBe(false);
      await rpc('release_run', last.reservationId);
      expect((await rpc('reserve_run', 'convert')).ok).toBe(true);
    });
  });

  it('rejects tools that are not counted or do not exist', async () => {
    const id = await newUser('tools@test.dev');
    await asUser(id, async () => {
      expect(await rpc('reserve_run', 'captions_transcribe')).toMatchObject({ ok: false, reason: 'invalid_tool' });
      expect(await rpc('reserve_run', 'silence_analyze')).toMatchObject({ ok: false, reason: 'invalid_tool' });
      expect(await rpc('reserve_run', 'not_a_tool')).toMatchObject({ ok: false, reason: 'invalid_tool' });
      expect((await rpc('get_entitlements')).quota.used).toBe(0);
    });
  });

  it('counts per day: yesterday\'s runs do not use today\'s quota', async () => {
    const id = await newUser('yesterday@test.dev');
    await db.query(
      `insert into public.usage_counters (user_id, day, count)
       values ($1, public.sao_paulo_today() - 1, 10)`,
      [id],
    );
    const r = await asUser(id, () => rpc('reserve_run', 'convert'));
    expect(r).toMatchObject({ ok: true, used: 1 });
  });
});

describe('paid plans', () => {
  const grant = (user: string, status: string, until: string | null) =>
    db.query(
      `insert into public.subscriptions (user_id, plan_id, status, access_until, source)
       values ($1, 'pro', $2, ${until ? `now() + interval '${until}'` : 'null'}, 'kiwify')`,
      [user, status],
    );

  it('removes the quota while a paid subscription is active', async () => {
    const id = await newUser('pro@test.dev');
    await grant(id, 'active', '30 days');
    await asUser(id, async () => {
      const e = await rpc('get_entitlements');
      expect(e).toMatchObject({ plan: 'pro', status: 'active', limits: DEFAULT_PLAN_LIMITS.pro, quota: { limit: null } });
      for (let i = 0; i < 25; i += 1) expect((await rpc('reserve_run', 'convert')).ok).toBe(true);
    });
  });

  it('keeps access for a canceled or late subscription until it runs out, and not after', async () => {
    const canceled = await newUser('canceled@test.dev');
    await grant(canceled, 'canceled', '3 days');
    expect((await asUser(canceled, () => rpc('get_entitlements'))).plan).toBe('pro');

    const late = await newUser('late@test.dev');
    await grant(late, 'past_due', '2 days');
    expect((await asUser(late, () => rpc('get_entitlements'))).status).toBe('past_due');

    const expired = await newUser('expired@test.dev');
    await grant(expired, 'active', '-1 day');
    expect(await asUser(expired, () => rpc('get_entitlements'))).toMatchObject({ plan: 'free', status: 'none' });
  });

  it('gives no access for refunded or charged-back purchases', async () => {
    for (const status of ['refunded', 'chargeback']) {
      const id = await newUser(`${status}@test.dev`);
      await grant(id, status, '30 days');
      expect((await asUser(id, () => rpc('get_entitlements'))).plan).toBe('free');
    }
  });
});

describe('purchases made before signing up (claim_pending_entitlements)', () => {
  const pending = (email: string, order: string) =>
    db.query(
      `insert into public.pending_entitlements (email_norm, plan_id, status, access_until, kiwify_order_id)
       values ($1, 'pro', 'active', now() + interval '30 days', $2)`,
      [email, order],
    );

  it('attaches the purchase to the verified e-mail, case- and space-insensitively, once', async () => {
    await pending('buyer@test.dev', 'order-1');
    const id = await newUser('  Buyer@Test.dev ');
    expect(await asUser(id, () => rpc('claim_pending_entitlements'))).toBe(1);
    expect((await asUser(id, () => rpc('get_entitlements'))).plan).toBe('pro');
    expect(await asUser(id, () => rpc('claim_pending_entitlements'))).toBe(0);
  });

  it('does nothing for an e-mail that was never verified', async () => {
    await pending('unverified@test.dev', 'order-2');
    const id = await newUser('unverified@test.dev', false);
    expect(await asUser(id, () => rpc('claim_pending_entitlements'))).toBe(0);
    expect((await asUser(id, () => rpc('get_entitlements'))).plan).toBe('free');
  });

  it('never gives one buyer\'s purchase to another account', async () => {
    await pending('real-buyer@test.dev', 'order-3');
    const stranger = await newUser('stranger@test.dev');
    expect(await asUser(stranger, () => rpc('claim_pending_entitlements'))).toBe(0);
  });
});

describe('what a client may read or write directly (RLS)', () => {
  it('shows each user only their own rows', async () => {
    const a = await newUser('rls-a@test.dev');
    const b = await newUser('rls-b@test.dev');
    await db.query(
      `insert into public.subscriptions (user_id, plan_id, status, source) values ($1, 'pro', 'active', 'admin_override')`,
      [a],
    );
    await asUser(a, () => rpc('reserve_run', 'convert'));

    const asB = await asUser(b, async () => ({
      subs: (await db.query('select * from public.subscriptions')).rows,
      counters: (await db.query('select * from public.usage_counters')).rows,
      reservations: (await db.query('select * from public.usage_reservations')).rows,
      profiles: (await db.query('select id from public.profiles')).rows,
    }));
    expect(asB.subs).toEqual([]);
    expect(asB.counters).toEqual([]);
    expect(asB.reservations).toEqual([]);
    expect(asB.profiles).toEqual([{ id: b }]);

    const asA = await asUser(a, async () => (await db.query('select * from public.subscriptions')).rows);
    expect(asA).toHaveLength(1);
  });

  it('forbids direct writes and reads of tables that are server-only', async () => {
    const id = await newUser('rls-write@test.dev');
    await asUser(id, async () => {
      await expect(
        db.query(`insert into public.subscriptions (user_id, plan_id, status, source) values ($1, 'pro', 'active', 'kiwify')`, [id]),
      ).rejects.toThrow(/permission denied/);
      await expect(db.query(`update public.profiles set role = 'admin' where id = $1`, [id])).rejects.toThrow(/permission denied/);
      await expect(db.query(`update public.profiles set consent_analytics = true where id = $1`, [id])).rejects.toThrow(/permission denied/);
      await expect(db.query(`delete from public.usage_counters where user_id = $1`, [id])).rejects.toThrow(/permission denied/);
      await expect(db.query('select * from public.kiwify_events')).rejects.toThrow(/permission denied/);
      await expect(db.query('select * from public.events')).rejects.toThrow(/permission denied/);
      await expect(db.query('select * from public.admin_audit')).rejects.toThrow(/permission denied/);
      await expect(db.query('select * from public.pending_entitlements')).rejects.toThrow(/permission denied/);
      await expect(db.query('update public.plans set limits = \'{}\'')).rejects.toThrow(/permission denied/);
    });
  });

  it('does not expose the internal helpers to clients', async () => {
    const id = await newUser('helpers@test.dev');
    await asUser(id, async () => {
      await expect(db.query('select public.is_admin()')).rejects.toThrow(/permission denied/);
      await expect(db.query('select public.effective_subscription($1)', [id])).rejects.toThrow(/permission denied/);
    });
  });
});

describe('consent and data export', () => {
  it('records the analytics answer through set_consent only', async () => {
    const id = await newUser('consent@test.dev');
    await asUser(id, async () => {
      await rpc('set_consent', true);
      expect(await rpc('get_entitlements')).toMatchObject({ consentAnalytics: true, consentAnswered: true });
      await rpc('set_consent', false);
      expect(await rpc('get_entitlements')).toMatchObject({ consentAnalytics: false, consentAnswered: true });
    });
  });

  it('exports everything stored about the caller and nothing about others', async () => {
    const id = await newUser('export@test.dev');
    const other = await newUser('export-other@test.dev');
    await db.query(`insert into public.events (user_id, name) values ($1, 'tool_opened'), ($2, 'tool_opened')`, [id, other]);
    await asUser(id, () => rpc('reserve_run', 'convert'));

    const doc = await asUser(id, () => rpc('export_my_data'));
    expect(doc.profile.id).toBe(id);
    expect(doc.events).toHaveLength(1);
    expect(doc.usageCounters).toHaveLength(1);
    expect(JSON.stringify(doc)).not.toContain(other);
  });
});

describe('local seed (supabase/seed.sql)', () => {
  it('creates the dev admin account, idempotently', async () => {
    const seed = readFileSync(path.resolve(__dirname, '../seed.sql'), 'utf8');
    await db.exec(seed);
    await db.exec(seed);
    const r = await db.query<{ role: string; consent_analytics: boolean; email: string }>(
      `select p.role, p.consent_analytics, u.email from public.profiles p join auth.users u on u.id = p.id
       where u.email = 'dev@editools.local'`,
    );
    expect(r.rows).toEqual([{ role: 'admin', consent_analytics: false, email: 'dev@editools.local' }]);
  });
});

describe('admin tools', () => {
  it('refuses a normal user', async () => {
    const id = await newUser('notadmin@test.dev');
    await asUser(id, async () => {
      await expect(rpc('admin_set_own_plan', 'pro')).rejects.toThrow(/forbidden/);
      await expect(rpc('admin_reset_own_quota')).rejects.toThrow(/forbidden/);
    });
    expect((await db.query('select count(*)::int as n from public.admin_audit where admin_id = $1', [id])).rows[0]).toEqual({ n: 0 });
  });

  it('lets an admin flip their own plan and reset their quota, and audits it', async () => {
    const id = await newUser('admin@test.dev');
    await db.query(`update public.profiles set role = 'admin' where id = $1`, [id]);

    await asUser(id, async () => {
      expect((await rpc('admin_set_own_plan', 'pro')).plan).toBe('pro');
      expect((await rpc('admin_set_own_plan', 'free')).plan).toBe('free');

      for (let i = 0; i < 3; i += 1) await rpc('reserve_run', 'convert');
      expect((await rpc('get_entitlements')).quota.used).toBe(3);
      expect((await rpc('admin_reset_own_quota')).quota.used).toBe(0);

      await expect(rpc('admin_set_own_plan', 'enterprise')).rejects.toThrow(/invalid plan/);
    });

    const audit = await db.query<{ action: string }>('select action from public.admin_audit where admin_id = $1 order by id', [id]);
    expect(audit.rows.map((r) => r.action)).toEqual(['set_own_plan', 'set_own_plan', 'reset_own_quota']);
  });
});
