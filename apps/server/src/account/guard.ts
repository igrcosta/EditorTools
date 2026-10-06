import type { FastifyInstance } from 'fastify';
import { apiError } from '../media/errors';

/**
 * Keeps other web pages from driving the local API.
 *
 * The server listens on 127.0.0.1, but any website the user visits can still send requests there
 * (CSRF), and a hostile DNS name can be re-pointed at 127.0.0.1 (DNS rebinding) to read the
 * answers. Before accounts that only meant "someone could run a conversion"; now the same API
 * spends the user's quota and can delete their account, so it is closed down:
 *
 * 1. Host must be a loopback name (defeats DNS rebinding: the page's own host name is not loopback).
 * 2. A state-changing request that carries an Origin must come from this very origin (defeats CSRF,
 *    including "simple" cross-origin multipart posts that never trigger a preflight).
 * 3. Account/admin routes additionally need a custom header. A cross-origin page cannot add one
 *    without a CORS preflight, which the CORS allow-list refuses.
 *
 * A per-launch secret token was considered and dropped: another local process can fetch it as
 * easily as the app can, and every path a browser can take is already covered by the checks above.
 */

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const PROTECTED_PREFIXES = ['/api/auth/', '/api/account/', '/api/admin/', '/api/desktop/'];

/** Sent by the web app on every API call. */
export const CLIENT_HEADER = 'x-editools-client';

/** The host name of a Host header value: "localhost:3001" → "localhost", "[::1]:3001" → "[::1]". */
export function hostnameOf(hostHeader: string | undefined): string | null {
  if (!hostHeader) return null;
  // A DNS name / IPv4 (letters, digits, dot, dash, underscore) or a bracketed IPv6 literal, then an optional port.
  const match = /^(\[[0-9a-f:.]+\]|[a-z0-9._-]+)(?::\d+)?$/.exec(hostHeader.trim().toLowerCase());
  return match ? match[1] : null;
}

export function isSameOrigin(origin: string, hostHeader: string | undefined): boolean {
  if (!hostHeader) return false;
  try {
    return new URL(origin).host.toLowerCase() === hostHeader.trim().toLowerCase();
  } catch {
    return false; // includes the literal "null" origin of sandboxed frames and file: pages
  }
}

export interface GuardOptions {
  /** True when the server is bound to this machine only; a shared deployment has its own public Host. */
  enforceHost: boolean;
  /** Extra origins allowed to make state-changing calls (the Vite dev server). */
  allowedOrigins: readonly string[];
}

export function registerLocalGuard(app: FastifyInstance, options: GuardOptions): void {
  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/')) return;
    const host = request.headers.host;

    if (options.enforceHost) {
      const name = hostnameOf(host);
      if (!name || !LOOPBACK_HOSTS.has(name)) return reply.code(403).send(apiError('blocked_host'));
    }

    if (!UNSAFE_METHODS.has(request.method)) return;

    const origin = request.headers.origin;
    if (origin && !isSameOrigin(origin, host) && !options.allowedOrigins.includes(origin)) {
      return reply.code(403).send(apiError('blocked_host'));
    }

    const path = request.url.split('?')[0];
    if (PROTECTED_PREFIXES.some((prefix) => path.startsWith(prefix)) && request.headers[CLIENT_HEADER] !== '1') {
      return reply.code(403).send(apiError('forbidden'));
    }
  });
}
