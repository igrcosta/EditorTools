// Kiwify webhook signature: the `signature` query parameter is the HMAC-SHA1 (hex) of the request
// body, keyed with the webhook token. Kiwify's docs do not say whether the body is the raw bytes or
// a re-serialised JSON, so BOTH are accepted and the one that matched is reported (and stored with
// the event) — once real deliveries show which, only that one should stay. UNVERIFIED until then.
//
// Web Crypto only, so it runs in Deno and Node alike.

export type SignatureMode = 'raw' | 'canonical';

const encoder = new TextEncoder();

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function hmacSha1Hex(token: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(token), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  return toHex(await crypto.subtle.sign('HMAC', key, encoder.encode(message)));
}

/** Compares without stopping at the first difference. */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Which representation of the body the signature matches, or null if neither. */
export async function verifyKiwifySignature(
  token: string,
  rawBody: string,
  signature: string | null,
): Promise<SignatureMode | null> {
  if (!token || !signature) return null;
  const given = signature.trim().toLowerCase();

  if (timingSafeEqualHex(await hmacSha1Hex(token, rawBody), given)) return 'raw';
  try {
    const canonical = JSON.stringify(JSON.parse(rawBody));
    if (canonical !== rawBody && timingSafeEqualHex(await hmacSha1Hex(token, canonical), given)) return 'canonical';
  } catch {
    // not JSON: only the raw form could ever match
  }
  return null;
}
