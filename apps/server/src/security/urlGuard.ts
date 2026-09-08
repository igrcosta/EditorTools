import { lookup } from 'node:dns/promises';
import net from 'node:net';
import type { ErrorCode } from '@editools/shared';

export class UrlGuardError extends Error {
  constructor(public readonly code: ErrorCode) {
    super(code);
  }
}

/**
 * SSRF guard: every user-provided URL must pass through here before being
 * handed to yt-dlp. Only http(s), no private/reserved hosts, and every DNS
 * answer for the hostname must resolve to a public address.
 */
export async function assertSafeUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UrlGuardError('invalid_url');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UrlGuardError('unsupported_scheme');
  }

  // URL.hostname wraps IPv6 literals in brackets.
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();

  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) throw new UrlGuardError('blocked_host');
    return url;
  }

  // Reject obvious internal names before touching DNS.
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || !hostname.includes('.')) {
    throw new UrlGuardError('blocked_host');
  }

  let addresses;
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new UrlGuardError('unresolvable_host');
  }
  if (addresses.length === 0 || addresses.some((a) => isPrivateIp(a.address))) {
    throw new UrlGuardError('blocked_host');
  }

  return url;
}

export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) return isPrivateIPv4(ip);
  return isPrivateIPv6(ip);
}

function isPrivateIPv4(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number);
  if (a === 0 || a === 10 || a === 127) return true; // "this", private, loopback
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 169 && b === 254) return true; // link-local / cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 192 && b === 0) return true; // IETF protocol assignments
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a >= 224) return true; // multicast + reserved
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const s = ip.toLowerCase();
  if (s === '::' || s === '::1') return true; // unspecified, loopback
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (mapped) return isPrivateIPv4(mapped[1]); // IPv4-mapped
  const first = s.split(':')[0];
  if (/^f[cd]/.test(first)) return true; // fc00::/7 unique local
  if (/^fe[89ab]/.test(first)) return true; // fe80::/10 link-local
  return false;
}
