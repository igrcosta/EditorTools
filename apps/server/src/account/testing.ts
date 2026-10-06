import { generateKeyPairSync, type KeyObject } from 'node:crypto';
import { DEFAULT_PLAN_LIMITS, type Entitlements, type PlanId, type SignedLimits } from '@editools/shared';
import { importSigningKey, signLimits } from '../../../../supabase/functions/_shared/limits-signing';
import { CloudError, type AuthSession, type CloudClient } from './cloud';
import { parsePublicKey } from './limits';

// Test support (not a test file): a stand-in for the Supabase backend that behaves like the real one
// for everything the account code uses. Shared by the service and enforcement tests.

export const pair = generateKeyPairSync('ed25519');
export const PRIVATE_B64 = pair.privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64');
export const PUBLIC_KEY: KeyObject = parsePublicKey(pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'));

export const T0 = 1_800_000_000_000; // ms
export const DAY = 24 * 60 * 60 * 1000;

export class FakeCloud implements CloudClient {
  online = true;
  refreshRejected = false;
  plan: PlanId = 'free';
  used = 0;
  userId = 'user-1';
  email = 'ana@test.dev';
  code = '123456';
  tokenLifetimeSeconds = 3600;
  refreshCalls = 0;
  calls: string[] = [];
  private seq = 0;
  clock: () => number;

  constructor(clock: () => number) {
    this.clock = clock;
  }

  private guard() {
    if (!this.online) throw new CloudError('network', 'down');
  }

  private session(): AuthSession {
    this.seq += 1;
    return {
      accessToken: `access-${this.seq}`,
      refreshToken: `refresh-${this.seq}`,
      expiresAt: Math.floor(this.clock() / 1000) + this.tokenLifetimeSeconds,
      user: { id: this.userId, email: this.email },
    };
  }

  entitlements(): Entitlements {
    const limits = DEFAULT_PLAN_LIMITS[this.plan];
    return {
      plan: this.plan,
      status: this.plan === 'pro' ? 'active' : 'none',
      accessUntil: null,
      limits,
      quota: { used: this.used, limit: limits.dailyRuns, resetsAt: new Date(this.clock() + DAY / 2).toISOString() },
      role: 'user',
      consentAnalytics: false,
      consentAnswered: false,
    };
  }

  async requestCode() {
    this.guard();
    this.calls.push('requestCode');
  }
  async verifyCode(_email: string, code: string) {
    this.guard();
    if (code !== this.code) throw new CloudError('invalid', 'bad code', 400);
    return this.session();
  }
  async refresh(_token: string) {
    this.refreshCalls += 1;
    this.guard();
    if (this.refreshRejected) throw new CloudError('unauthorized', 'refresh refused', 401);
    return this.session();
  }
  async logout() {
    this.calls.push('logout');
  }
  async rpc<T>(_token: string, fn: string): Promise<T> {
    this.guard();
    this.calls.push(`rpc:${fn}`);
    if (fn === 'reserve_run') {
      const limit = DEFAULT_PLAN_LIMITS[this.plan].dailyRuns;
      if (limit !== null && this.used >= limit) {
        return { ok: false, reason: 'quota_exceeded', used: this.used, limit, remaining: 0, resetsAt: this.entitlements().quota.resetsAt } as T;
      }
      this.used += 1;
      return { ok: true, reservationId: `res-${this.used}`, used: this.used, limit, remaining: limit === null ? null : limit - this.used, resetsAt: this.entitlements().quota.resetsAt } as T;
    }
    if (fn === 'release_run') {
      this.used = Math.max(0, this.used - 1);
      return true as T;
    }
    return null as T;
  }
  async callFunction<T>(_token: string, name: string): Promise<T | null> {
    this.guard();
    this.calls.push(`fn:${name}`);
    if (name !== 'get-entitlements') return null;
    const entitlements = this.entitlements();
    const signed: SignedLimits = await signLimits(await importSigningKey(PRIVATE_B64), {
      sub: this.userId,
      plan: this.plan,
      limits: entitlements.limits,
      nowSeconds: Math.floor(this.clock() / 1000),
    });
    return { entitlements, signed } as T;
  }
}
