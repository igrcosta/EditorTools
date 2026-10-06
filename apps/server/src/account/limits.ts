import { createPublicKey, verify, type KeyObject } from 'node:crypto';
import { limitsPayloadMessage, type PlanLimits, type SignedLimits } from '@editools/shared';

/**
 * Verifies the plan limits the cloud signed for a user (see supabase/functions/_shared/limits-signing.ts).
 * That signature is what lets the app keep enforcing per-job limits while offline, for a bounded
 * grace period, without trusting a file the user can edit.
 */

// DER prefix of an Ed25519 SubjectPublicKeyInfo; the 32 raw key bytes follow it.
const SPKI_ED25519_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

/** Accepts the public key as base64 SPKI DER, or as the bare 32 raw bytes. */
export function parsePublicKey(base64: string): KeyObject {
  const raw = Buffer.from(base64, 'base64');
  const der = raw.length === 32 ? Buffer.concat([SPKI_ED25519_PREFIX, raw]) : raw;
  return createPublicKey({ key: der, format: 'der', type: 'spki' });
}

export type LimitsVerdict =
  | { ok: true; signed: SignedLimits }
  | { ok: false; reason: 'malformed' | 'bad_signature' | 'wrong_user' | 'expired' };

function isLimits(value: unknown): value is PlanLimits {
  if (!value || typeof value !== 'object') return false;
  const l = value as Record<string, unknown>;
  const nullableNumber = (v: unknown) => v === null || (typeof v === 'number' && Number.isFinite(v));
  return (
    nullableNumber(l.dailyRuns) &&
    nullableNumber(l.maxMediaSeconds) &&
    nullableNumber(l.maxUploadBytes) &&
    nullableNumber(l.maxDownloadHeight) &&
    (l.allowedUpscaleScales === null ||
      (Array.isArray(l.allowedUpscaleScales) && l.allowedUpscaleScales.every((n) => typeof n === 'number')))
  );
}

function isSignedLimits(value: unknown): value is SignedLimits {
  if (!value || typeof value !== 'object') return false;
  const v = value as { payload?: Record<string, unknown>; signature?: unknown };
  const p = v.payload;
  return (
    typeof v.signature === 'string' &&
    !!p &&
    typeof p.sub === 'string' &&
    (p.plan === 'free' || p.plan === 'pro') &&
    typeof p.iat === 'number' &&
    typeof p.exp === 'number' &&
    isLimits(p.limits)
  );
}

export function verifySignedLimits(
  input: unknown,
  publicKey: KeyObject,
  opts: { userId: string; nowSeconds?: number },
): LimitsVerdict {
  if (!isSignedLimits(input)) return { ok: false, reason: 'malformed' };

  let valid = false;
  try {
    valid = verify(
      null,
      Buffer.from(limitsPayloadMessage(input.payload)),
      publicKey,
      Buffer.from(input.signature, 'base64url'),
    );
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, reason: 'bad_signature' };
  if (input.payload.sub !== opts.userId) return { ok: false, reason: 'wrong_user' };
  if (input.payload.exp <= (opts.nowSeconds ?? Math.floor(Date.now() / 1000))) return { ok: false, reason: 'expired' };
  return { ok: true, signed: input };
}
