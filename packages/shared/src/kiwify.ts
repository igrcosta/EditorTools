// Kiwify webhook payloads -> subscription state. Pure and import-free (the Edge Function runs it in
// Deno and the tests in Node), like plans.ts.
//
// WHAT IS VERIFIED vs NOT: Kiwify's webhook documentation was read from memory/help pages, not from a
// real delivery. Field names and event names below are the documented ones plus Portuguese aliases,
// and every read is defensive (a missing or odd field never throws; it just yields "ignored"). The
// first real payloads (a card purchase and a Pix purchase) must be captured from the webhook log and
// checked against `parseKiwifyEvent` — see supabase/README.md. Until then, treat the exact event
// names and the date format (time zone) as UNVERIFIED.

export type KiwifyKind = 'approved' | 'renewed' | 'late' | 'canceled' | 'refunded' | 'chargeback' | 'ignored';

export interface KiwifyEvent {
  kind: KiwifyKind;
  /** The raw event name as sent, kept for the log. */
  rawType: string;
  /** Normalised (trimmed, lower-case) buyer e-mail, or null when absent/invalid. */
  email: string | null;
  productId: string | null;
  /** Stable key for the subscription: its id when present, otherwise the order id. */
  key: string | null;
  orderId: string | null;
  /** When the next charge is due (ms since epoch). */
  nextPaymentAt: number | null;
  /** Access end date as computed by Kiwify itself, if the payload carries one (ms). */
  customerAccessUntil: number | null;
  /** When the event happened according to the payload (ms), if known. */
  occurredAt: number | null;
}

export type SubStatus = 'active' | 'past_due' | 'canceled' | 'refunded' | 'chargeback';

export interface SubState {
  status: SubStatus;
  /** Paid access ends here (grace included); null means no known end. */
  accessUntil: number | null;
  /** When the last applied event happened (ms); used to ignore stale, out-of-order events. */
  updatedAt: number;
}

export interface KiwifyPolicy {
  /** Days of access kept after a due date that was not paid (Kiwify itself waits 5 days). */
  graceDays: number;
  /** Length of one billing period, used only when the payload gives no next-payment date. */
  periodDays: number;
  /** After a cancellation: keep access until the paid period ends, or cut it right away. */
  cancelAccess: 'end_of_period' | 'immediate';
}

export const DEFAULT_KIWIFY_POLICY: KiwifyPolicy = { graceDays: 5, periodDays: 31, cancelAccess: 'end_of_period' };

const DAY_MS = 24 * 60 * 60 * 1000;

const KIND_BY_TYPE: Record<string, KiwifyKind> = {
  order_approved: 'approved',
  compra_aprovada: 'approved',
  subscription_renewed: 'renewed',
  assinatura_renovada: 'renewed',
  subscription_late: 'late',
  assinatura_atrasada: 'late',
  subscription_canceled: 'canceled',
  subscription_cancelled: 'canceled',
  assinatura_cancelada: 'canceled',
  order_refunded: 'refunded',
  compra_reembolsada: 'refunded',
  chargeback: 'chargeback',
  chargedback: 'chargeback',
};

const KIND_BY_ORDER_STATUS: Record<string, KiwifyKind> = {
  paid: 'approved',
  refunded: 'refunded',
  chargedback: 'chargeback',
};

function obj(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function str(value: unknown): string | null {
  if (typeof value === 'string') {
    const v = value.trim();
    return v ? v : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function first(...values: unknown[]): string | null {
  for (const v of values) {
    const s = str(v);
    if (s) return s;
  }
  return null;
}

/** Parses an ISO-ish date to ms. A date with no time zone is read as UTC (UNVERIFIED for Kiwify). */
export function parseKiwifyDate(value: unknown): number | null {
  const s = str(value);
  if (!s) return null;
  const naive = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s);
  const t = Date.parse(naive ? `${s.replace(' ', 'T')}Z` : s);
  return Number.isFinite(t) ? t : null;
}

export function normalizeEmail(value: unknown): string | null {
  const s = str(value)?.toLowerCase() ?? null;
  return s && s.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : null;
}

/** Reads a Kiwify webhook body (already JSON-parsed) without ever throwing. */
export function parseKiwifyEvent(body: unknown): KiwifyEvent {
  const root = obj(body);
  const customer = obj(root.Customer ?? root.customer);
  const product = obj(root.Product ?? root.product);
  const subscription = obj(root.Subscription ?? root.subscription);
  const access = obj(subscription.customer_access);

  const rawType = first(root.webhook_event_type, root.event, root.trigger) ?? '';
  const orderStatus = first(root.order_status)?.toLowerCase() ?? null;

  let kind: KiwifyKind = KIND_BY_TYPE[rawType.toLowerCase()] ?? 'ignored';
  if (kind === 'ignored' && !rawType && orderStatus) kind = KIND_BY_ORDER_STATUS[orderStatus] ?? 'ignored';
  // An "approved" event for an order that is not actually paid must not grant access.
  if ((kind === 'approved' || kind === 'renewed') && orderStatus && orderStatus !== 'paid') kind = 'ignored';

  const orderId = first(root.order_id, root.order_ref);
  return {
    kind,
    rawType,
    email: normalizeEmail(customer.email ?? root.email),
    productId: first(product.product_id, product.id, root.product_id),
    key: first(subscription.id, root.subscription_id, orderId),
    orderId,
    nextPaymentAt: parseKiwifyDate(subscription.next_payment),
    customerAccessUntil: parseKiwifyDate(access.access_until),
    occurredAt: parseKiwifyDate(root.updated_at ?? root.approved_date ?? root.created_at),
  };
}

const ENDS = new Set<SubStatus>(['refunded', 'chargeback']);

/**
 * The next subscription state after an event. `prev` is the stored state (null for a new
 * subscription), `now` the receipt time. Returns `prev` untouched for events that do not change
 * access, so callers can compare and skip the write.
 */
export function applyKiwifyEvent(
  prev: SubState | null,
  event: KiwifyEvent,
  now: number,
  policy: KiwifyPolicy = DEFAULT_KIWIFY_POLICY,
): SubState | null {
  if (event.kind === 'ignored') return prev;
  const at = event.occurredAt ?? now;

  // A refunded / charged-back subscription stays revoked unless a LATER event revives it, so a
  // replayed or out-of-order old "approved" cannot hand the access back.
  if (prev && ENDS.has(prev.status) && at <= prev.updatedAt) return prev;

  const grace = policy.graceDays * DAY_MS;
  const prevLive = prev && !ENDS.has(prev.status) ? prev.accessUntil : null;

  switch (event.kind) {
    case 'approved':
    case 'renewed': {
      const candidate =
        event.customerAccessUntil ??
        (event.nextPaymentAt !== null ? event.nextPaymentAt + grace : now + policy.periodDays * DAY_MS + grace);
      // Never shorten access because an older payment event arrived late.
      const accessUntil = prevLive !== null ? Math.max(prevLive, candidate) : candidate;
      return { status: 'active', accessUntil, updatedAt: at };
    }
    case 'late':
      // Overdue: access continues, but only until the end of the grace that was already running.
      return { status: 'past_due', accessUntil: prevLive ?? now + grace, updatedAt: at };
    case 'canceled': {
      const accessUntil =
        policy.cancelAccess === 'immediate' ? now : (event.customerAccessUntil ?? prevLive ?? now);
      return { status: 'canceled', accessUntil: Math.min(accessUntil, prevLive ?? accessUntil), updatedAt: at };
    }
    case 'refunded':
      return { status: 'refunded', accessUntil: now, updatedAt: at };
    case 'chargeback':
      return { status: 'chargeback', accessUntil: now, updatedAt: at };
  }
}
