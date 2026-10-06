import { type KeyObject } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PLAN_LIMITS } from '@editools/shared';
import { DAY, FakeCloud, PUBLIC_KEY, T0 } from './testing';
import { AccountService, MemorySessionStore } from './service';

function setup(opts: { publicKey?: KeyObject | null; store?: MemorySessionStore } = {}) {
  let now = T0;
  const clock = () => now;
  const cloud = new FakeCloud(clock);
  const store = opts.store ?? new MemorySessionStore();
  const service = new AccountService({
    cloud,
    store,
    publicKey: opts.publicKey === undefined ? PUBLIC_KEY : opts.publicKey,
    now: clock,
  });
  return { service, cloud, store, advance: (ms: number) => (now += ms), clock };
}

async function signedIn(opts?: Parameters<typeof setup>[0]) {
  const ctx = setup(opts);
  await ctx.service.requestCode('Ana@Test.dev ');
  await ctx.service.verifyCode('Ana@Test.dev ', ' 123456 ');
  return ctx;
}

describe('accounts disabled', () => {
  it('reports "disabled" and never needs the backend', () => {
    const service = new AccountService({ cloud: null, store: new MemorySessionStore(), publicKey: null });
    expect(service.enabled).toBe(false);
    expect(service.info()).toEqual({ state: 'disabled' });
    expect(service.limits()).toBeNull();
  });
});

describe('signing in', () => {
  it('starts anonymous, then holds the session and entitlements after the code is verified', async () => {
    const { service, cloud, store } = setup();
    expect(service.info()).toEqual({ state: 'anonymous' });

    await service.requestCode('Ana@Test.dev ');
    const info = await service.verifyCode('Ana@Test.dev ', ' 123456 ');

    expect(info).toMatchObject({
      state: 'authenticated',
      offline: false,
      user: { id: 'user-1', email: 'ana@test.dev' },
      entitlements: { plan: 'free', quota: { used: 0, limit: 10 } },
    });
    expect(store.loadRefreshToken()).toMatch(/^refresh-/);
    expect(store.loadOfflineCache()?.user.id).toBe('user-1');
    expect(cloud.calls).toContain('rpc:claim_pending_entitlements'); // purchases made before signing up
    expect(service.limits()).toEqual(DEFAULT_PLAN_LIMITS.free);
  });

  it('rejects a wrong code and stays signed out', async () => {
    const { service } = setup();
    await expect(service.verifyCode('ana@test.dev', '000000')).rejects.toMatchObject({ kind: 'invalid' });
    expect(service.info()).toEqual({ state: 'anonymous' });
  });

  it('signs out locally even if the backend is down, and forgets everything stored', async () => {
    const { service, cloud, store } = await signedIn();
    cloud.online = false;
    await service.signOut();
    expect(service.info()).toEqual({ state: 'anonymous' });
    expect(store.loadRefreshToken()).toBeNull();
    expect(store.loadOfflineCache()).toBeNull();
  });

  it('revokes the session on the backend when it can', async () => {
    const { service, cloud } = await signedIn();
    await service.signOut();
    expect(cloud.calls).toContain('logout');
  });
});

describe('daily quota', () => {
  it('takes a run per counted job and lets the preview steps through untouched', async () => {
    const { service, cloud } = await signedIn();
    expect(await service.reserveRun('captions_transcribe')).toEqual({ ok: true, reservationId: null });
    expect(await service.reserveRun('silence_analyze')).toEqual({ ok: true, reservationId: null });
    expect(cloud.calls.filter((c) => c === 'rpc:reserve_run')).toHaveLength(0);

    const r = await service.reserveRun('convert');
    expect(r).toMatchObject({ ok: true, reservationId: 'res-1' });
    const info = service.info();
    expect(info.state === 'authenticated' && info.entitlements.quota.used).toBe(1);
  });

  it('blocks the 11th run with the reset time, and a release frees one', async () => {
    const { service } = await signedIn();
    let last: Awaited<ReturnType<typeof service.reserveRun>> | undefined;
    for (let i = 0; i < 10; i += 1) last = await service.reserveRun('convert');
    const blocked = await service.reserveRun('convert');
    expect(blocked).toMatchObject({ ok: false, code: 'quota_exceeded' });
    expect((blocked as { resetsAt?: string }).resetsAt).toBeTruthy();

    expect(last && last.ok).toBe(true);
    await service.releaseRun((last as { reservationId: string }).reservationId);
    expect(await service.reserveRun('convert')).toMatchObject({ ok: true });
  });

  it('never limits a paid plan', async () => {
    const { service, cloud } = await signedIn();
    cloud.plan = 'pro';
    await service.refreshEntitlements({ force: true });
    for (let i = 0; i < 30; i += 1) expect((await service.reserveRun('convert')).ok).toBe(true);
    expect(service.limits()).toEqual(DEFAULT_PLAN_LIMITS.pro);
  });

  it('refuses everything while signed out', async () => {
    const { service } = setup();
    expect(await service.reserveRun('convert')).toEqual({ ok: false, code: 'unauthenticated' });
  });

  it('treats a refused session as signed out', async () => {
    const { service, cloud, advance } = await signedIn();
    cloud.refreshRejected = true;
    advance(2 * 60 * 60 * 1000); // access token expired -> needs a refresh, which is refused
    expect(await service.reserveRun('convert')).toEqual({ ok: false, code: 'unauthenticated' });
    expect(service.info()).toEqual({ state: 'anonymous' });
  });
});

describe('tokens', () => {
  it('refreshes an expired access token once, even for concurrent calls, and stores the rotated refresh token', async () => {
    const { service, cloud, store, advance } = await signedIn();
    const before = store.loadRefreshToken();
    advance(2 * 60 * 60 * 1000);
    cloud.refreshCalls = 0;

    await Promise.all([service.reserveRun('convert'), service.reserveRun('convert'), service.reserveRun('convert')]);
    expect(cloud.refreshCalls).toBe(1);
    expect(store.loadRefreshToken()).not.toBe(before);
  });
});

describe('restoring a session at startup (init)', () => {
  it('signs back in from the stored refresh token', async () => {
    const first = await signedIn();
    const { service } = setup({ store: first.store });
    await service.init();
    expect(service.info()).toMatchObject({ state: 'authenticated', offline: false, user: { id: 'user-1' } });
  });

  it('does nothing when no one was signed in', async () => {
    const { service } = setup();
    await service.init();
    expect(service.info()).toEqual({ state: 'anonymous' });
  });

  it('forgets a session the backend no longer accepts', async () => {
    const first = await signedIn();
    const { service, cloud, store } = setup({ store: first.store });
    cloud.refreshRejected = true;
    await service.init();
    expect(service.info()).toEqual({ state: 'anonymous' });
    expect(store.loadRefreshToken()).toBeNull();
    expect(store.loadOfflineCache()).toBeNull();
  });
});

describe('offline grace', () => {
  async function restoredOffline(opts?: { publicKey?: KeyObject | null; mutateStore?: (s: MemorySessionStore) => void }) {
    const first = await signedIn();
    opts?.mutateStore?.(first.store);
    const ctx = setup({ store: first.store, publicKey: opts?.publicKey });
    ctx.cloud.online = false;
    await ctx.service.init();
    return ctx;
  }

  it('keeps working on the signed limits while the backend is unreachable', async () => {
    const { service } = await restoredOffline();
    expect(service.info()).toMatchObject({ state: 'authenticated', offline: true, user: { id: 'user-1' } });
    expect(service.limits()).toEqual(DEFAULT_PLAN_LIMITS.free);
  });

  it('lets runs through offline up to the plan limit, counted locally, then blocks', async () => {
    const { service } = await restoredOffline();
    for (let i = 0; i < 10; i += 1) expect(await service.reserveRun('convert')).toEqual({ ok: true, reservationId: null });
    expect(await service.reserveRun('convert')).toMatchObject({ ok: false, code: 'quota_exceeded' });
  });

  it('counts offline runs on top of what was already used today', async () => {
    const first = await signedIn();
    for (let i = 0; i < 8; i += 1) await first.service.reserveRun('convert');
    await first.service.refreshEntitlements({ force: true }); // cache now says used = 8
    const ctx = setup({ store: first.store });
    ctx.cloud.online = false;
    await ctx.service.init();

    expect((await ctx.service.reserveRun('convert')).ok).toBe(true);
    expect((await ctx.service.reserveRun('convert')).ok).toBe(true);
    expect(await ctx.service.reserveRun('convert')).toMatchObject({ ok: false, code: 'quota_exceeded' });
  });

  it('stops working once the grace period is over', async () => {
    const first = await signedIn();
    const ctx = setup({ store: first.store });
    ctx.cloud.online = false;
    ctx.advance(8 * DAY);
    await ctx.service.init();
    expect(ctx.service.info()).toEqual({ state: 'unreachable' });
    expect(await ctx.service.reserveRun('convert')).toEqual({ ok: false, code: 'account_offline' });
  });

  it('has no grace at all without the signing public key', async () => {
    const { service } = await restoredOffline({ publicKey: null });
    expect(service.info()).toEqual({ state: 'unreachable' });
  });

  it('refuses limits that were edited on disk (a user cannot raise their own plan)', async () => {
    const { service } = await restoredOffline({
      mutateStore: (store) => {
        const cache = store.loadOfflineCache()!;
        cache.signed.payload.plan = 'pro';
        cache.signed.payload.limits = DEFAULT_PLAN_LIMITS.pro;
        store.saveOfflineCache(cache);
      },
    });
    expect(service.info()).toEqual({ state: 'unreachable' });
  });

  it('trusts the signed plan, not the editable display copy next to it', async () => {
    const { service } = await restoredOffline({
      mutateStore: (store) => {
        const cache = store.loadOfflineCache()!;
        cache.entitlements = { ...cache.entitlements, plan: 'pro', limits: DEFAULT_PLAN_LIMITS.pro };
        store.saveOfflineCache(cache);
      },
    });
    expect(service.info()).toMatchObject({ state: 'authenticated', offline: true, entitlements: { plan: 'free' } });
    expect(service.limits()).toEqual(DEFAULT_PLAN_LIMITS.free);
  });

  it('falls back to the grace when the backend drops after a successful sign-in', async () => {
    const { service, cloud } = await signedIn();
    cloud.online = false;
    await service.refreshEntitlements({ force: true });
    expect(service.info()).toMatchObject({ state: 'authenticated', offline: true });
    cloud.online = true;
    await service.refreshEntitlements({ force: true });
    expect(service.info()).toMatchObject({ state: 'authenticated', offline: false });
  });
});

describe('account actions', () => {
  it('forgets everything after the account is deleted', async () => {
    const { service, cloud, store } = await signedIn();
    await service.deleteAccount();
    expect(cloud.calls).toContain('fn:delete-account');
    expect(service.info()).toEqual({ state: 'anonymous' });
    expect(store.loadRefreshToken()).toBeNull();
  });

  it('re-reads the entitlements after an admin changes the plan', async () => {
    const { service, cloud } = await signedIn();
    cloud.plan = 'pro';
    const info = await service.adminSetPlan('pro');
    expect(info).toMatchObject({ state: 'authenticated', entitlements: { plan: 'pro' } });
    expect(cloud.calls).toContain('rpc:admin_set_own_plan');
  });
});
