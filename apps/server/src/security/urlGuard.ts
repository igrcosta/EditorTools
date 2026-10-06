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

/**
 * The 16 bytes of an IPv6 address, or null if it can't be read. Handles `::` compression, a
 * dotted-quad tail (`::ffff:1.2.3.4`, which is what dns.lookup returns for mapped addresses) and
 * zone ids. Comparing bytes rather than text matters here: `new URL('http://[::ffff:127.0.0.1]/')`
 * normalises the host to `[::ffff:7f00:1]`, and a text match on the dotted form never sees it.
 */
function ipv6Bytes(ip: string): Uint8Array | null {
  let s = ip.toLowerCase();
  const zone = s.indexOf('%');
  if (zone >= 0) s = s.slice(0, zone);

  const tail = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(s);
  if (tail) {
    const [a, b, c, d] = tail.slice(1).map(Number);
    if ([a, b, c, d].some((n) => n > 255)) return null;
    s = `${s.slice(0, tail.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }

  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = halves.length === 2 ? 8 - head.length - rest.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const groups = [...head, ...Array<string>(fill).fill('0'), ...rest];
  if (groups.length !== 8) return null;

  const bytes = new Uint8Array(16);
  for (const [i, g] of groups.entries()) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    const value = parseInt(g, 16);
    bytes[i * 2] = value >> 8;
    bytes[i * 2 + 1] = value & 0xff;
  }
  return bytes;
}

function embeddedIPv4(bytes: Uint8Array, at: number): string {
  return `${bytes[at]}.${bytes[at + 1]}.${bytes[at + 2]}.${bytes[at + 3]}`;
}

/** True for loopback, private, link-local, multicast and every IPv6 form that tunnels to an IPv4 address. */
function isPrivateIPv6(ip: string): boolean {
  const b = ipv6Bytes(ip);
  if (!b) return true; // can't tell what it is: refuse rather than guess

  const zero = (from: number, to: number) => b.slice(from, to).every((x) => x === 0);

  if (zero(0, 10) && b[10] === 0xff && b[11] === 0xff) return isPrivateIPv4(embeddedIPv4(b, 12)); // ::ffff:0:0/96 IPv4-mapped
  if (zero(0, 12)) return true; // ::/96 unspecified, loopback, IPv4-compatible
  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b) {
    // 64:ff9b::/96 NAT64 reaches the embedded IPv4 address; 64:ff9b:1::/48 is local-use
    return zero(4, 12) ? isPrivateIPv4(embeddedIPv4(b, 12)) : true;
  }
  if (b[0] === 0x20 && b[1] === 0x02) return isPrivateIPv4(embeddedIPv4(b, 2)); // 2002::/16 6to4
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x00 && b[3] === 0x00) return true; // 2001::/32 Teredo
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x0d && b[3] === 0xb8) return true; // 2001:db8::/32 documentation
  if ((b[0] & 0xfe) === 0xfc) return true; // fc00::/7 unique local
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0x80) return true; // fe80::/10 link-local
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0xc0) return true; // fec0::/10 site-local (deprecated)
  if (b[0] === 0xff) return true; // ff00::/8 multicast
  return false;
}
