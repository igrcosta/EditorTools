/**
 * Thin client for the Supabase backend: GoTrue (sign-in by e-mail code), PostgREST RPC and Edge
 * Functions. Plain `fetch`, no SDK (smaller esbuild bundle, nothing to externalise), and the fetch
 * function is injectable so the rest of the account code can be tested without a network.
 *
 * Only the project URL and the public anon key are ever used here. The service-role key does not
 * exist on the client side of this system.
 */

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  /** Unix seconds. */
  expiresAt: number;
  user: { id: string; email: string };
}

/**
 * What went wrong, in terms the caller can act on:
 * - `network`: the backend could not be reached (or answered 5xx) — offline behaviour may apply;
 * - `unauthorized`: the token or code was refused — the user must sign in again;
 * - `rate_limited`: too many requests (e.g. sign-in codes);
 * - `invalid`: the request was refused for another reason (wrong code, bad e-mail…);
 * - `forbidden`: the database refused the action for this user (e.g. admin only).
 */
export type CloudErrorKind = 'network' | 'unauthorized' | 'rate_limited' | 'invalid' | 'forbidden';

export class CloudError extends Error {
  constructor(
    public readonly kind: CloudErrorKind,
    message: string,
    public readonly status = 0,
  ) {
    super(message);
  }
}

export interface CloudClient {
  requestCode(email: string): Promise<void>;
  verifyCode(email: string, code: string): Promise<AuthSession>;
  refresh(refreshToken: string): Promise<AuthSession>;
  /** Revokes the refresh token server-side. Best effort. */
  logout(accessToken: string): Promise<void>;
  rpc<T>(accessToken: string, fn: string, args?: Record<string, unknown>): Promise<T>;
  callFunction<T>(accessToken: string, name: string, body?: unknown): Promise<T | null>;
}

type FetchFn = typeof fetch;

const REQUEST_TIMEOUT_MS = 15_000;

function kindFor(status: number): CloudErrorKind {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'network';
  return 'invalid';
}

interface RawSession {
  access_token?: string;
  refresh_token?: string;
  expires_at?: number;
  expires_in?: number;
  user?: { id?: string; email?: string };
}

function toSession(raw: RawSession, nowSeconds: number): AuthSession {
  if (!raw.access_token || !raw.refresh_token || !raw.user?.id) {
    throw new CloudError('invalid', 'incomplete session from the backend');
  }
  return {
    accessToken: raw.access_token,
    refreshToken: raw.refresh_token,
    expiresAt: raw.expires_at ?? nowSeconds + (raw.expires_in ?? 3600),
    user: { id: raw.user.id, email: raw.user.email ?? '' },
  };
}

export function createCloudClient(
  options: { url: string; anonKey: string },
  fetchFn: FetchFn = fetch,
  now: () => number = () => Math.floor(Date.now() / 1000),
): CloudClient {
  const { url, anonKey } = options;

  async function send(path: string, init: RequestInit & { accessToken?: string }): Promise<Response> {
    const headers: Record<string, string> = {
      apikey: anonKey,
      'Content-Type': 'application/json',
      Authorization: `Bearer ${init.accessToken ?? anonKey}`,
    };
    let res: Response;
    try {
      res = await fetchFn(`${url}${path}`, {
        method: init.method ?? 'POST',
        headers,
        body: init.body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new CloudError('network', 'the backend could not be reached');
    }
    if (!res.ok) {
      // Never put the response body in the message: it can echo what we sent (e-mail, code).
      throw new CloudError(kindFor(res.status), `backend answered ${res.status}`, res.status);
    }
    return res;
  }

  return {
    async requestCode(email) {
      await send('/auth/v1/otp', { body: JSON.stringify({ email, create_user: true }) });
    },

    async verifyCode(email, code) {
      const res = await send('/auth/v1/verify', { body: JSON.stringify({ type: 'email', email, token: code }) });
      return toSession((await res.json()) as RawSession, now());
    },

    async refresh(refreshToken) {
      const res = await send('/auth/v1/token?grant_type=refresh_token', {
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      return toSession((await res.json()) as RawSession, now());
    },

    async logout(accessToken) {
      await send('/auth/v1/logout', { accessToken, body: '{}' });
    },

    async rpc<T>(accessToken: string, fn: string, args: Record<string, unknown> = {}) {
      const res = await send(`/rest/v1/rpc/${encodeURIComponent(fn)}`, { accessToken, body: JSON.stringify(args) });
      const text = await res.text();
      return (text ? JSON.parse(text) : null) as T;
    },

    async callFunction<T>(accessToken: string, name: string, body: unknown = {}) {
      const res = await send(`/functions/v1/${encodeURIComponent(name)}`, { accessToken, body: JSON.stringify(body) });
      const text = await res.text();
      return (text ? JSON.parse(text) : null) as T | null;
    },
  };
}
