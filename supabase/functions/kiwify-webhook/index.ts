// kiwify-webhook: receives Kiwify's payment events and turns them into plan access.
//
// Authentication is the HMAC signature (verify_jwt = false in config.toml: Kiwify has no JWT). An
// event whose signature does not match is refused and NOT processed.
//
// Secrets (supabase secrets set ...):
//   KIWIFY_WEBHOOK_TOKEN   the token of the webhook configured in Kiwify (Apps > Webhooks)
//   KIWIFY_PRODUCT_IDS     comma-separated product ids that grant Pro. Empty = grants nothing.
// Optional: KIWIFY_LOG_REJECTED=1 also stores events with a bad signature (debugging only).
//
// Every accepted delivery is stored whole in kiwify_events first (idempotent on a hash of the body,
// so Kiwify's retries are harmless), then processed. A processing failure answers 500 so Kiwify
// retries; the stored row lets the retry pick up where it stopped. It never throws on a missing
// field: unknown events are logged and ignored.

import { applyKiwifyEvent, DEFAULT_KIWIFY_POLICY, parseKiwifyEvent, type SubState } from '../../../packages/shared/src/kiwify.ts';
import { verifyKiwifySignature, type SignatureMode } from '../_shared/kiwify-signature.ts';

const MAX_BODY_BYTES = 256 * 1024;
const PLAN_FOR_PURCHASE = 'pro';
const encoder = new TextEncoder();

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

function json(status: number, body: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response(null, { status: 405 });

  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const token = Deno.env.get('KIWIFY_WEBHOOK_TOKEN');
  if (!url || !serviceKey || !token) return new Response(null, { status: 500 });
  const db = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' };

  const declared = Number(req.headers.get('content-length') ?? '0');
  if (declared > MAX_BODY_BYTES) return new Response(null, { status: 413 });
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return new Response(null, { status: 413 });

  const signature = new URL(req.url).searchParams.get('signature');
  const mode: SignatureMode | null = await verifyKiwifySignature(token, raw, signature);

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    body = null;
  }
  const event = parseKiwifyEvent(body);

  if (!mode) {
    if (Deno.env.get('KIWIFY_LOG_REJECTED') === '1' && body !== null) {
      await fetch(`${url}/rest/v1/kiwify_events`, {
        method: 'POST',
        headers: { ...db, Prefer: 'return=minimal,resolution=ignore-duplicates' },
        body: JSON.stringify({
          idem_key: `rejected:${await sha256Hex(raw)}`,
          webhook_event_type: event.rawType || null,
          order_id: event.orderId,
          signature_ok: false,
          payload: body,
          error: 'bad_signature',
        }),
      });
    }
    return new Response(null, { status: 401 });
  }
  if (body === null) return json(400);

  // 1. Store the delivery (once). A retry of the same body finds the row already there.
  const idemKey = await sha256Hex(raw);
  await fetch(`${url}/rest/v1/kiwify_events`, {
    method: 'POST',
    headers: { ...db, Prefer: 'return=minimal,resolution=ignore-duplicates' },
    body: JSON.stringify({
      idem_key: idemKey,
      webhook_event_type: event.rawType || null,
      order_id: event.orderId,
      signature_ok: true,
      signature_mode: mode,
      payload: body,
    }),
  });

  const stored = await fetch(`${url}/rest/v1/kiwify_events?idem_key=eq.${idemKey}&select=processed_at`, { headers: db });
  if (!stored.ok) return new Response(null, { status: 500 });
  const rows = (await stored.json()) as Array<{ processed_at: string | null }>;
  if (rows[0]?.processed_at) return json(200, { duplicate: true });

  const finish = (error: string | null) =>
    fetch(`${url}/rest/v1/kiwify_events?idem_key=eq.${idemKey}`, {
      method: 'PATCH',
      headers: { ...db, Prefer: 'return=minimal' },
      body: JSON.stringify({ processed_at: new Date().toISOString(), error }),
    });

  // 2. Decide what the event means.
  if (event.kind === 'ignored') {
    await finish(null);
    return json(200, { ignored: true });
  }

  const allowed = (Deno.env.get('KIWIFY_PRODUCT_IDS') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!event.productId || !allowed.includes(event.productId)) {
    await finish('product_not_allowed');
    return json(200, { ignored: true });
  }
  if (!event.email || !event.key) {
    await finish('missing_buyer_or_key');
    return json(200, { ignored: true });
  }

  // 3. Compute and store the new state.
  const now = Date.now();
  const stateRes = await fetch(`${url}/rest/v1/rpc/kiwify_get_state`, {
    method: 'POST',
    headers: db,
    body: JSON.stringify({ p_key: event.key }),
  });
  if (!stateRes.ok) return new Response(null, { status: 500 });
  const stateRows = (await stateRes.json()) as Array<{ status: SubState['status']; access_until: string | null; updated_at: string }>;
  const prev: SubState | null = stateRows[0]
    ? {
        status: stateRows[0].status,
        accessUntil: stateRows[0].access_until ? Date.parse(stateRows[0].access_until) : null,
        updatedAt: Date.parse(stateRows[0].updated_at),
      }
    : null;

  const next = applyKiwifyEvent(prev, event, now, DEFAULT_KIWIFY_POLICY);
  if (!next || next === prev) {
    await finish(null);
    return json(200, { unchanged: true });
  }

  const applied = await fetch(`${url}/rest/v1/rpc/kiwify_apply`, {
    method: 'POST',
    headers: db,
    body: JSON.stringify({
      p_key: event.key,
      p_email: event.email,
      p_product: event.productId,
      p_plan: PLAN_FOR_PURCHASE,
      p_status: next.status,
      p_access_until: next.accessUntil === null ? null : new Date(next.accessUntil).toISOString(),
    }),
  });
  if (!applied.ok) return new Response(null, { status: 500 }); // not marked processed: Kiwify's retry redoes it

  await finish(null);
  return json(200, { applied: event.kind });
});
