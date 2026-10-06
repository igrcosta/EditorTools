import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parsePublicKey, verifySignedLimits } from '../../../apps/server/src/account/limits';
import { DEFAULT_PLAN_LIMITS, OFFLINE_GRACE_SECONDS } from '../../../packages/shared/src/plans';
import { importSigningKey, signLimits } from './limits-signing';

// Sign with the Edge Function code (WebCrypto), verify with the server code (node:crypto): the two
// halves of the offline-limits mechanism must agree byte for byte.

const pair = generateKeyPairSync('ed25519');
const privateKeyB64 = pair.privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64');
const spkiB64 = pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
const rawPublicB64 = pair.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64');

const NOW = 1_800_000_000;

async function sign(overrides: { sub?: string; plan?: 'free' | 'pro'; nowSeconds?: number } = {}) {
  const key = await importSigningKey(privateKeyB64);
  const plan = overrides.plan ?? 'free';
  return signLimits(key, {
    sub: overrides.sub ?? 'user-1',
    plan,
    limits: DEFAULT_PLAN_LIMITS[plan],
    nowSeconds: overrides.nowSeconds ?? NOW,
  });
}

describe('signed plan limits', () => {
  it('verifies what the Edge Function signs, for SPKI and raw public keys', async () => {
    const signed = await sign();
    for (const pub of [spkiB64, rawPublicB64]) {
      const verdict = verifySignedLimits(signed, parsePublicKey(pub), { userId: 'user-1', nowSeconds: NOW + 60 });
      expect(verdict).toEqual({ ok: true, signed });
    }
    expect(signed.payload.exp - signed.payload.iat).toBe(OFFLINE_GRACE_SECONDS);
  });

  it('survives a JSON round trip with reordered keys', async () => {
    const signed = await sign({ plan: 'pro' });
    const roundTripped = JSON.parse(JSON.stringify({ signature: signed.signature, payload: { exp: signed.payload.exp, iat: signed.payload.iat, limits: signed.payload.limits, plan: signed.payload.plan, sub: signed.payload.sub } }));
    expect(verifySignedLimits(roundTripped, parsePublicKey(spkiB64), { userId: 'user-1', nowSeconds: NOW }).ok).toBe(true);
  });

  it('rejects any edited field (a user cannot raise their own limits)', async () => {
    const signed = await sign();
    const key = parsePublicKey(spkiB64);
    const edits = [
      { ...signed, payload: { ...signed.payload, plan: 'pro' as const } },
      { ...signed, payload: { ...signed.payload, limits: { ...signed.payload.limits, dailyRuns: 1000 } } },
      { ...signed, payload: { ...signed.payload, limits: { ...signed.payload.limits, maxDownloadHeight: 4320 } } },
      { ...signed, payload: { ...signed.payload, exp: signed.payload.exp + 10_000_000 } },
    ];
    for (const edited of edits) {
      expect(verifySignedLimits(edited, key, { userId: 'user-1', nowSeconds: NOW })).toEqual({ ok: false, reason: 'bad_signature' });
    }
  });

  it('rejects a signature made with a different key', async () => {
    const other = generateKeyPairSync('ed25519');
    const otherPub = other.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
    const signed = await sign();
    expect(verifySignedLimits(signed, parsePublicKey(otherPub), { userId: 'user-1', nowSeconds: NOW })).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });

  it('rejects limits that belong to another user, and expired ones', async () => {
    const signed = await sign({ sub: 'user-1' });
    const key = parsePublicKey(spkiB64);
    expect(verifySignedLimits(signed, key, { userId: 'user-2', nowSeconds: NOW })).toEqual({ ok: false, reason: 'wrong_user' });
    expect(verifySignedLimits(signed, key, { userId: 'user-1', nowSeconds: signed.payload.exp })).toEqual({ ok: false, reason: 'expired' });
    expect(verifySignedLimits(signed, key, { userId: 'user-1', nowSeconds: signed.payload.exp - 1 }).ok).toBe(true);
  });

  it('treats garbage as malformed rather than throwing', () => {
    const key = parsePublicKey(spkiB64);
    for (const junk of [null, undefined, 'x', 42, {}, { payload: {}, signature: 'x' }, { payload: { sub: 1 }, signature: 's' }]) {
      expect(verifySignedLimits(junk, key, { userId: 'user-1' })).toEqual({ ok: false, reason: 'malformed' });
    }
  });
});
