import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { timingSafeEqualHex, verifyKiwifySignature } from './kiwify-signature';

const TOKEN = 'webhook-token';
const sign = (message: string) => createHmac('sha1', TOKEN).update(message).digest('hex');
const RAW = '{"order_id": "1",  "Customer": {"email": "a@b.co"}}'; // odd spacing on purpose

describe('verifyKiwifySignature', () => {
  it('accepts the signature of the raw body and says so', async () => {
    expect(await verifyKiwifySignature(TOKEN, RAW, sign(RAW))).toBe('raw');
  });

  it('accepts the signature of the re-serialised JSON and says so', async () => {
    const canonical = JSON.stringify(JSON.parse(RAW));
    expect(canonical).not.toBe(RAW);
    expect(await verifyKiwifySignature(TOKEN, RAW, sign(canonical))).toBe('canonical');
  });

  it('is case-insensitive about the hex and tolerates surrounding spaces', async () => {
    expect(await verifyKiwifySignature(TOKEN, RAW, ` ${sign(RAW).toUpperCase()} `)).toBe('raw');
  });

  it('refuses a wrong token, a tampered body, a missing or malformed signature', async () => {
    expect(await verifyKiwifySignature('other', RAW, sign(RAW))).toBeNull();
    expect(await verifyKiwifySignature(TOKEN, RAW + ' ', sign(RAW))).toBeNull();
    expect(await verifyKiwifySignature(TOKEN, RAW, null)).toBeNull();
    expect(await verifyKiwifySignature(TOKEN, RAW, '')).toBeNull();
    expect(await verifyKiwifySignature(TOKEN, RAW, 'zz')).toBeNull();
    expect(await verifyKiwifySignature('', RAW, sign(RAW))).toBeNull();
  });

  it('does not throw on a body that is not JSON', async () => {
    expect(await verifyKiwifySignature(TOKEN, 'not json', sign('not json'))).toBe('raw');
    expect(await verifyKiwifySignature(TOKEN, 'not json', sign('other'))).toBeNull();
  });

  it('compares hex strings of equal length only', () => {
    expect(timingSafeEqualHex('ab', 'ab')).toBe(true);
    expect(timingSafeEqualHex('ab', 'ac')).toBe(false);
    expect(timingSafeEqualHex('ab', 'abc')).toBe(false);
  });
});
