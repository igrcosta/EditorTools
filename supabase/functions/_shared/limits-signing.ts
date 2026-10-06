// Signs the plan limits that the desktop app caches for offline use (Ed25519, WebCrypto).
//
// Runs on Deno (Edge Functions) and on Node (tests); it only uses WebCrypto and `atob`/`btoa`.
// The relative import carries a `.ts` extension because Deno requires it. The matching verifier
// is apps/server/src/account/limits.ts, and a unit test signs here and verifies there.

import {
  OFFLINE_GRACE_SECONDS,
  limitsPayloadMessage,
  type LimitsPayload,
  type PlanId,
  type PlanLimits,
  type SignedLimits,
} from '../../../packages/shared/src/plans.ts';

// Not `CryptoKey`: that global is a DOM type, absent from the Node typings the repo is checked with.
type SigningKey = Awaited<ReturnType<typeof crypto.subtle.importKey>>;

function fromBase64(value: string): Uint8Array {
  const binary = atob(value.replace(/\s+/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** `pkcs8Base64` is the private key as base64 PKCS#8 DER — the LIMITS_PRIVATE_KEY Edge Function secret. */
export function importSigningKey(pkcs8Base64: string): Promise<SigningKey> {
  return crypto.subtle.importKey('pkcs8', fromBase64(pkcs8Base64), { name: 'Ed25519' }, false, ['sign']);
}

export async function signLimits(
  key: SigningKey,
  input: { sub: string; plan: PlanId; limits: PlanLimits; nowSeconds?: number; graceSeconds?: number },
): Promise<SignedLimits> {
  const iat = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const payload: LimitsPayload = {
    sub: input.sub,
    plan: input.plan,
    limits: input.limits,
    iat,
    exp: iat + (input.graceSeconds ?? OFFLINE_GRACE_SECONDS),
  };
  const message = new TextEncoder().encode(limitsPayloadMessage(payload));
  const signature = new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, key, message));
  return { payload, signature: toBase64Url(signature) };
}
