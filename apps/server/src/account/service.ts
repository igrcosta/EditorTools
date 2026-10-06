import type { KeyObject } from 'node:crypto';
import {
  isCountedTool,
  type Entitlements,
  type PlanId,
  type PlanLimits,
  type SessionInfo,
  type SignedLimits,
  type ToolId,
} from '@editools/shared';
import { CloudError, type AuthSession, type CloudClient } from './cloud';
import { verifySignedLimits } from './limits';

/**
 * The local server's view of the user's account: the signed-in session, the plan, the quota, and
 * what to do when the backend cannot be reached.
 *
 * Trust model (see CLAUDE.md): processing happens on the user's machine, so limits are enforced by
 * code the user controls. The daily quota is the one authoritative control — it is counted by the
 * database. Per-job limits come from the database while online and from a cloud-signed payload
 * while offline (a 7-day grace). Tokens never leave this process: the web UI only ever sees
 * SessionInfo.
 */

/** Persistence supplied by the host (the desktop app encrypts the refresh token with `safeStorage`). */
export interface SessionStore {
  loadRefreshToken(): string | null;
  saveRefreshToken(token: string | null): void;
  loadOfflineCache(): OfflineCache | null;
  saveOfflineCache(cache: OfflineCache | null): void;
}

export interface OfflineCache {
  user: { id: string; email: string };
  /** Last entitlements seen online. Display only: the limits that count are `signed`. */
  entitlements: Entitlements;
  signed: SignedLimits;
  /** Milliseconds since epoch. */
  savedAt: number;
  /** Runs let through while offline today, counted locally. */
  offlineRuns?: { day: string; count: number };
}

/** In-memory store: used when the host gives none (web demo, dev) and in tests. */
export class MemorySessionStore implements SessionStore {
  private refreshToken: string | null = null;
  private cache: OfflineCache | null = null;
  loadRefreshToken() {
    return this.refreshToken;
  }
  saveRefreshToken(token: string | null) {
    this.refreshToken = token;
  }
  loadOfflineCache() {
    return this.cache;
  }
  saveOfflineCache(cache: OfflineCache | null) {
    this.cache = cache;
  }
}

export type ReserveResult =
  | { ok: true; reservationId: string | null }
  | { ok: false; code: 'unauthenticated' | 'quota_exceeded' | 'account_offline'; resetsAt?: string };

interface RpcReserve {
  ok: boolean;
  reason?: string;
  reservationId?: string;
  used?: number;
  limit?: number | null;
  remaining?: number | null;
  resetsAt?: string;
}

/** Calendar day in São Paulo, the boundary of the daily quota. */
function saoPauloDay(ms: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(ms));
}

/** Entitlements are not re-fetched more often than this unless forced (the web app polls them). */
const MIN_REFRESH_INTERVAL_MS = 5_000;

export class AccountService {
  private session: AuthSession | null = null;
  private user: { id: string; email: string } | null = null;
  private entitlements: Entitlements | null = null;
  private cache: OfflineCache | null = null;
  private offline = false;
  private unreachable = false;
  private refreshing: Promise<AuthSession> | null = null;
  private lastEntitlementsAt = 0;

  constructor(
    private readonly options: {
      /** Null when accounts are not configured: everything below becomes a no-op ('disabled'). */
      cloud: CloudClient | null;
      store: SessionStore;
      /** Null disables the offline grace (the network is then always required). */
      publicKey: KeyObject | null;
      /** Milliseconds since epoch; injectable for tests. */
      now?: () => number;
    },
  ) {}

  private now(): number {
    return (this.options.now ?? Date.now)();
  }
  private nowSeconds(): number {
    return Math.floor(this.now() / 1000);
  }

  get enabled(): boolean {
    return this.options.cloud !== null;
  }

  private get cloud(): CloudClient {
    if (!this.options.cloud) throw new Error('accounts are not configured');
    return this.options.cloud;
  }

  // ---------------------------------------------------------------------------
  // Session
  // ---------------------------------------------------------------------------

  info(): SessionInfo {
    if (!this.enabled) return { state: 'disabled' };
    if (this.user && this.entitlements) {
      return { state: 'authenticated', user: this.user, entitlements: this.entitlements, offline: this.offline };
    }
    if (this.unreachable) return { state: 'unreachable' };
    return { state: 'anonymous' };
  }

  /** The limits that apply right now, or null when nobody is signed in. */
  limits(): PlanLimits | null {
    return this.user && this.entitlements ? this.entitlements.limits : null;
  }

  currentUserId(): string | null {
    return this.user?.id ?? null;
  }

  /** Restores the previous session at startup. Never throws: failures just leave the user signed out or offline. */
  async init(): Promise<void> {
    if (!this.enabled) return;
    const refreshToken = this.options.store.loadRefreshToken();
    if (!refreshToken) return;
    this.cache = this.options.store.loadOfflineCache();

    try {
      this.adopt(await this.cloud.refresh(refreshToken));
    } catch (err) {
      if (err instanceof CloudError && err.kind === 'unauthorized') {
        this.clearLocal();
        return;
      }
      this.fallBackToOffline();
      return;
    }
    await this.syncOrFallBack();
  }

  async requestCode(email: string): Promise<void> {
    await this.cloud.requestCode(email.trim().toLowerCase());
  }

  async verifyCode(email: string, code: string): Promise<SessionInfo> {
    const session = await this.cloud.verifyCode(email.trim().toLowerCase(), code.trim());
    this.adopt(session);
    this.unreachable = false;
    try {
      // A purchase made before the account existed attaches to the now-verified e-mail.
      await this.cloud.rpc(session.accessToken, 'claim_pending_entitlements');
    } catch {
      // Not fatal: it is retried implicitly the next time the user signs in.
    }
    await this.refreshEntitlements({ force: true });
    return this.info();
  }

  async signOut(): Promise<void> {
    const token = this.session?.accessToken;
    this.clearLocal();
    if (token && this.options.cloud) {
      try {
        await this.options.cloud.logout(token);
      } catch {
        // Best effort: the local session is already gone.
      }
    }
  }

  private adopt(session: AuthSession): void {
    this.session = session;
    this.user = session.user;
    // Refresh tokens rotate: the newest one must always be what is stored.
    this.options.store.saveRefreshToken(session.refreshToken);
  }

  private clearLocal(): void {
    this.session = null;
    this.user = null;
    this.entitlements = null;
    this.cache = null;
    this.offline = false;
    this.unreachable = false;
    this.options.store.saveRefreshToken(null);
    this.options.store.saveOfflineCache(null);
  }

  /** A valid access token, refreshing it (once, even for concurrent callers) if it is about to expire. */
  private async accessToken(): Promise<string> {
    if (this.session && this.session.expiresAt - this.nowSeconds() > 60) return this.session.accessToken;
    const refreshToken = this.session?.refreshToken ?? this.options.store.loadRefreshToken();
    if (!refreshToken) throw new CloudError('unauthorized', 'not signed in');

    this.refreshing ??= this.cloud
      .refresh(refreshToken)
      .then((s) => {
        this.adopt(s);
        return s;
      })
      .finally(() => {
        this.refreshing = null;
      });
    try {
      return (await this.refreshing).accessToken;
    } catch (err) {
      if (err instanceof CloudError && err.kind === 'unauthorized') this.clearLocal();
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // Entitlements and the offline grace
  // ---------------------------------------------------------------------------

  async refreshEntitlements(opts: { force?: boolean } = {}): Promise<SessionInfo> {
    if (!this.enabled || !this.user) return this.info();
    if (!opts.force && this.entitlements && !this.offline && this.now() - this.lastEntitlementsAt < MIN_REFRESH_INTERVAL_MS) {
      return this.info();
    }
    await this.syncOrFallBack();
    return this.info();
  }

  /** Fetches fresh entitlements; if the backend is unreachable, keeps working on the offline grace when there is one. */
  private async syncOrFallBack(): Promise<void> {
    try {
      const token = await this.accessToken();
      const res = await this.cloud.callFunction<{ entitlements: Entitlements; signed: SignedLimits }>(
        token,
        'get-entitlements',
      );
      if (!res?.entitlements) throw new CloudError('invalid', 'empty entitlements');

      this.entitlements = res.entitlements;
      this.offline = false;
      this.unreachable = false;
      this.lastEntitlementsAt = this.now();
      this.saveCache(res.signed);
    } catch (err) {
      if (err instanceof CloudError && err.kind === 'unauthorized') return; // accessToken() already signed out
      this.fallBackToOffline();
    }
  }

  private saveCache(signed: SignedLimits | undefined): void {
    const { publicKey, store } = this.options;
    if (!publicKey || !signed || !this.user || !this.entitlements) return;
    const verdict = verifySignedLimits(signed, publicKey, { userId: this.user.id, nowSeconds: this.nowSeconds() });
    if (!verdict.ok) return; // never cache what we could not verify
    this.cache = { user: this.user, entitlements: this.entitlements, signed, savedAt: this.now() };
    store.saveOfflineCache(this.cache);
  }

  /** The cached, cloud-signed limits if they are still valid for the stored user, else null. */
  private validOfflineCache(): OfflineCache | null {
    const { publicKey } = this.options;
    const cache = this.cache;
    if (!publicKey || !cache) return null;
    // Never run one user's session on another user's cached limits.
    if (this.user && this.user.id !== cache.user.id) return null;
    const verdict = verifySignedLimits(cache.signed, publicKey, { userId: cache.user.id, nowSeconds: this.nowSeconds() });
    return verdict.ok ? cache : null;
  }

  private fallBackToOffline(): void {
    const cache = this.validOfflineCache();
    if (!cache) {
      this.offline = false;
      this.entitlements = null;
      this.unreachable = true;
      return;
    }
    this.user = cache.user;
    this.unreachable = false;
    this.offline = true;
    // The limits that count are the signed ones, whatever the (editable) cached copy says.
    this.entitlements = {
      ...cache.entitlements,
      plan: cache.signed.payload.plan as PlanId,
      limits: cache.signed.payload.limits,
      quota: this.offlineQuota(cache),
    };
  }

  private offlineQuota(cache: OfflineCache): Entitlements['quota'] {
    const q = cache.entitlements.quota;
    const sameDay = this.now() < new Date(q.resetsAt).getTime();
    const local = cache.offlineRuns && cache.offlineRuns.day === saoPauloDay(this.now()) ? cache.offlineRuns.count : 0;
    return { ...q, limit: cache.signed.payload.limits.dailyRuns, used: (sameDay ? q.used : 0) + local };
  }

  // ---------------------------------------------------------------------------
  // Quota
  // ---------------------------------------------------------------------------

  /** Takes one run of today's quota before a job starts. Preview-style steps are not counted and always pass. */
  async reserveRun(tool: ToolId): Promise<ReserveResult> {
    if (!this.user) return { ok: false, code: this.unreachable ? 'account_offline' : 'unauthenticated' };
    if (!isCountedTool(tool)) return { ok: true, reservationId: null };

    try {
      const token = await this.accessToken();
      const r = await this.cloud.rpc<RpcReserve>(token, 'reserve_run', { p_tool: tool });
      this.applyQuota(r);
      if (r.ok && r.reservationId) {
        this.offline = false;
        return { ok: true, reservationId: r.reservationId };
      }
      if (r.reason === 'quota_exceeded') return { ok: false, code: 'quota_exceeded', resetsAt: r.resetsAt };
      throw new CloudError('invalid', `reserve_run refused: ${r.reason ?? 'unknown'}`);
    } catch (err) {
      if (err instanceof CloudError && err.kind === 'network') return this.reserveOffline();
      if (err instanceof CloudError && err.kind === 'unauthorized') return { ok: false, code: 'unauthenticated' };
      throw err;
    }
  }

  /**
   * Backend unreachable: fail OPEN, deliberately, within the signed limits and a local counter —
   * an honest user on a flaky connection should not be locked out of a tool they are entitled to.
   * Anyone can bypass a local counter (the processing is local anyway); that is the accepted
   * limitation documented in CLAUDE.md. The counter resets when the backend is reachable again.
   */
  private reserveOffline(): ReserveResult {
    const cache = this.validOfflineCache();
    if (!cache) {
      this.fallBackToOffline();
      return { ok: false, code: 'account_offline' };
    }
    this.fallBackToOffline();

    const limit = cache.signed.payload.limits.dailyRuns;
    const quota = this.entitlements!.quota;
    if (limit !== null && quota.used >= limit) {
      return { ok: false, code: 'quota_exceeded', resetsAt: quota.resetsAt };
    }

    const day = saoPauloDay(this.now());
    const count = (cache.offlineRuns?.day === day ? cache.offlineRuns.count : 0) + 1;
    this.cache = { ...cache, offlineRuns: { day, count } };
    this.options.store.saveOfflineCache(this.cache);
    this.fallBackToOffline();
    return { ok: true, reservationId: null };
  }

  /** Gives a run back (job failed or was canceled). Best effort: a lost release only costs the user one run. */
  async releaseRun(reservationId: string): Promise<void> {
    if (!this.user) return;
    try {
      const token = await this.accessToken();
      const released = await this.cloud.rpc<boolean>(token, 'release_run', { p_id: reservationId });
      if (released && this.entitlements) {
        const q = this.entitlements.quota;
        this.entitlements = { ...this.entitlements, quota: { ...q, used: Math.max(0, q.used - 1) } };
      }
    } catch {
      // Ignored on purpose; see above.
    }
  }

  private applyQuota(r: RpcReserve): void {
    if (!this.entitlements || typeof r.used !== 'number') return;
    this.entitlements = {
      ...this.entitlements,
      quota: {
        used: r.used,
        limit: r.limit ?? null,
        resetsAt: r.resetsAt ?? this.entitlements.quota.resetsAt,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Account actions
  // ---------------------------------------------------------------------------

  async setConsent(value: boolean): Promise<SessionInfo> {
    const token = await this.accessToken();
    await this.cloud.rpc(token, 'set_consent', { p_value: value });
    return this.refreshEntitlements({ force: true });
  }

  async exportData(): Promise<unknown> {
    return this.cloud.rpc(await this.accessToken(), 'export_my_data');
  }

  async deleteAccount(): Promise<void> {
    await this.cloud.callFunction(await this.accessToken(), 'delete-account');
    this.clearLocal();
  }

  /** Dev tools. The database refuses anyone who is not an admin, whatever this client does. */
  async adminSetPlan(plan: PlanId): Promise<SessionInfo> {
    await this.cloud.rpc(await this.accessToken(), 'admin_set_own_plan', { p_plan: plan });
    return this.refreshEntitlements({ force: true });
  }

  async adminResetQuota(): Promise<SessionInfo> {
    await this.cloud.rpc(await this.accessToken(), 'admin_reset_own_quota');
    return this.refreshEntitlements({ force: true });
  }
}
