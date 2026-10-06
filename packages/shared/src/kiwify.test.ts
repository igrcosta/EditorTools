import { describe, expect, it } from 'vitest';
import {
  applyKiwifyEvent,
  DEFAULT_KIWIFY_POLICY,
  normalizeEmail,
  parseKiwifyDate,
  parseKiwifyEvent,
  type KiwifyEvent,
  type SubState,
} from './kiwify';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-10-10T12:00:00Z');

function ev(partial: Partial<KiwifyEvent>): KiwifyEvent {
  return {
    kind: 'approved',
    rawType: 'order_approved',
    email: 'ana@test.dev',
    productId: 'prod-1',
    key: 'sub-1',
    orderId: 'ord-1',
    nextPaymentAt: null,
    customerAccessUntil: null,
    occurredAt: null,
    ...partial,
  };
}

describe('parseKiwifyEvent', () => {
  const body = {
    webhook_event_type: 'order_approved',
    order_id: 'ord-1',
    order_status: 'paid',
    Customer: { email: '  Ana@Test.DEV ' },
    Product: { product_id: 'prod-1' },
    Subscription: { id: 'sub-1', next_payment: '2026-11-10T12:00:00Z' },
  };

  it('reads the documented fields', () => {
    expect(parseKiwifyEvent(body)).toMatchObject({
      kind: 'approved',
      email: 'ana@test.dev',
      productId: 'prod-1',
      key: 'sub-1',
      orderId: 'ord-1',
      nextPaymentAt: Date.parse('2026-11-10T12:00:00Z'),
    });
  });

  it('falls back to the order id as the key when there is no subscription', () => {
    const { Subscription: _s, ...rest } = body;
    expect(parseKiwifyEvent(rest).key).toBe('ord-1');
  });

  it.each([
    ['order_approved', 'approved'],
    ['compra_aprovada', 'approved'],
    ['subscription_renewed', 'renewed'],
    ['subscription_late', 'late'],
    ['subscription_canceled', 'canceled'],
    ['order_refunded', 'refunded'],
    ['chargeback', 'chargeback'],
    ['pix_created', 'ignored'],
    ['billet_created', 'ignored'],
    ['something_new', 'ignored'],
  ])('maps %s to %s', (type, kind) => {
    expect(parseKiwifyEvent({ ...body, order_status: undefined, webhook_event_type: type }).kind).toBe(kind);
  });

  it('never grants for an approved event whose order is not paid', () => {
    expect(parseKiwifyEvent({ ...body, order_status: 'waiting_payment' }).kind).toBe('ignored');
    expect(parseKiwifyEvent({ ...body, order_status: 'refused' }).kind).toBe('ignored');
  });

  it('uses the order status when the event name is missing', () => {
    expect(parseKiwifyEvent({ order_status: 'refunded', order_id: 'x' }).kind).toBe('refunded');
  });

  it('survives garbage without throwing', () => {
    for (const junk of [null, undefined, 42, 'x', [], {}, { Customer: 5, Subscription: [] }]) {
      expect(parseKiwifyEvent(junk).kind).toBe('ignored');
    }
  });

  it('rejects a buyer address that is not an e-mail', () => {
    expect(parseKiwifyEvent({ ...body, Customer: { email: 'not an email' } }).email).toBeNull();
    expect(normalizeEmail('a@b.co')).toBe('a@b.co');
    expect(normalizeEmail('x'.repeat(300) + '@b.co')).toBeNull();
  });

  it('reads a date without a time zone as UTC and ignores nonsense', () => {
    expect(parseKiwifyDate('2026-10-10 12:00')).toBe(NOW);
    expect(parseKiwifyDate('2026-10-10T12:00:00-03:00')).toBe(Date.parse('2026-10-10T15:00:00Z'));
    expect(parseKiwifyDate('banana')).toBeNull();
    expect(parseKiwifyDate(undefined)).toBeNull();
  });

  it('prefers the access end Kiwify reports for the customer', () => {
    const e = parseKiwifyEvent({
      ...body,
      Subscription: { id: 's', customer_access: { access_until: '2026-12-01T00:00:00Z' } },
    });
    expect(e.customerAccessUntil).toBe(Date.parse('2026-12-01T00:00:00Z'));
  });
});

describe('applyKiwifyEvent', () => {
  it('grants until the next payment plus the grace on a first purchase', () => {
    const next = NOW + 30 * DAY;
    const s = applyKiwifyEvent(null, ev({ nextPaymentAt: next }), NOW)!;
    expect(s).toMatchObject({ status: 'active', accessUntil: next + 5 * DAY });
  });

  it('falls back to one period plus grace when the payload has no date', () => {
    const s = applyKiwifyEvent(null, ev({}), NOW)!;
    expect(s.accessUntil).toBe(NOW + 31 * DAY + 5 * DAY);
  });

  it('extends on renewal and never shortens when an older payment arrives late', () => {
    const s1 = applyKiwifyEvent(null, ev({ nextPaymentAt: NOW + 30 * DAY }), NOW)!;
    const s2 = applyKiwifyEvent(s1, ev({ kind: 'renewed', nextPaymentAt: NOW + 60 * DAY }), NOW + 30 * DAY)!;
    expect(s2.accessUntil).toBe(NOW + 65 * DAY);
    const stale = applyKiwifyEvent(s2, ev({ kind: 'renewed', nextPaymentAt: NOW + 30 * DAY }), NOW + 31 * DAY)!;
    expect(stale.accessUntil).toBe(s2.accessUntil);
  });

  it('keeps access (past_due) through the grace after a late payment, without extending it', () => {
    const active = applyKiwifyEvent(null, ev({ nextPaymentAt: NOW }), NOW)!; // until NOW + 5d
    const late = applyKiwifyEvent(active, ev({ kind: 'late' }), NOW + DAY)!;
    expect(late).toMatchObject({ status: 'past_due', accessUntil: NOW + 5 * DAY });
  });

  it('keeps access until the paid period ends after a cancellation, by default', () => {
    const active = applyKiwifyEvent(null, ev({ nextPaymentAt: NOW + 20 * DAY }), NOW)!;
    const canceled = applyKiwifyEvent(active, ev({ kind: 'canceled' }), NOW + DAY)!;
    expect(canceled).toMatchObject({ status: 'canceled', accessUntil: active.accessUntil });
  });

  it('cuts access at once when the policy says so', () => {
    const active = applyKiwifyEvent(null, ev({ nextPaymentAt: NOW + 20 * DAY }), NOW)!;
    const canceled = applyKiwifyEvent(active, ev({ kind: 'canceled' }), NOW + DAY, {
      ...DEFAULT_KIWIFY_POLICY,
      cancelAccess: 'immediate',
    })!;
    expect(canceled.accessUntil).toBe(NOW + DAY);
  });

  it('a cancellation after an unpaid grace leaves no access', () => {
    const active = applyKiwifyEvent(null, ev({ nextPaymentAt: NOW }), NOW)!;
    const late = applyKiwifyEvent(active, ev({ kind: 'late' }), NOW + DAY)!;
    const canceled = applyKiwifyEvent(late, ev({ kind: 'canceled' }), NOW + 6 * DAY)!;
    expect(canceled.accessUntil!).toBeLessThanOrEqual(NOW + 5 * DAY);
  });

  it.each(['refunded', 'chargeback'] as const)('revokes immediately on %s', (kind) => {
    const active = applyKiwifyEvent(null, ev({ nextPaymentAt: NOW + 20 * DAY }), NOW)!;
    const s = applyKiwifyEvent(active, ev({ kind }), NOW + DAY)!;
    expect(s).toMatchObject({ status: kind, accessUntil: NOW + DAY });
  });

  it('does not let a replayed old approval revive a refunded subscription', () => {
    const active = applyKiwifyEvent(null, ev({ occurredAt: NOW, nextPaymentAt: NOW + 20 * DAY }), NOW)!;
    const refunded = applyKiwifyEvent(active, ev({ kind: 'refunded', occurredAt: NOW + DAY }), NOW + DAY)!;
    const replay = applyKiwifyEvent(refunded, ev({ occurredAt: NOW, nextPaymentAt: NOW + 20 * DAY }), NOW + 2 * DAY);
    expect(replay).toBe(refunded);
  });

  it('lets a genuinely newer purchase revive a refunded subscription (re-subscription)', () => {
    const refunded: SubState = { status: 'refunded', accessUntil: NOW, updatedAt: NOW };
    const s = applyKiwifyEvent(refunded, ev({ occurredAt: NOW + 10 * DAY, nextPaymentAt: NOW + 40 * DAY }), NOW + 10 * DAY)!;
    expect(s.status).toBe('active');
  });

  it('does nothing for ignored events', () => {
    const prev: SubState = { status: 'active', accessUntil: NOW + DAY, updatedAt: NOW };
    expect(applyKiwifyEvent(prev, ev({ kind: 'ignored' }), NOW)).toBe(prev);
    expect(applyKiwifyEvent(null, ev({ kind: 'ignored' }), NOW)).toBeNull();
  });
});
