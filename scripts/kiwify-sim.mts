// Sends a signed, Kiwify-shaped webhook to your project so every transition can be tested without
// buying anything. The payloads follow the documented field names; they are NOT copies of real
// deliveries (none had been captured when this was written), so a pass here proves our handling,
// not Kiwify's exact format.
//
//   KIWIFY_WEBHOOK_TOKEN=... npx tsx scripts/kiwify-sim.mts <event> <email> [--product ID] [--url URL]
//
// events: approved | renewed | late | canceled | refunded | chargeback
// The token is read from the environment so it never lands in shell history as an argument.
// Default URL: https://<project-ref>.supabase.co/functions/v1/kiwify-webhook (from cloud.config.json).

import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

const EVENTS: Record<string, { type: string; status: string }> = {
  approved: { type: 'order_approved', status: 'paid' },
  renewed: { type: 'subscription_renewed', status: 'paid' },
  late: { type: 'subscription_late', status: 'paid' },
  canceled: { type: 'subscription_canceled', status: 'paid' },
  refunded: { type: 'order_refunded', status: 'refunded' },
  chargeback: { type: 'chargeback', status: 'chargedback' },
};

const [event, email, ...rest] = process.argv.slice(2);
const flag = (name: string) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : undefined;
};

const token = process.env.KIWIFY_WEBHOOK_TOKEN;
if (!event || !EVENTS[event] || !email || !token) {
  console.error('usage: KIWIFY_WEBHOOK_TOKEN=... npx tsx scripts/kiwify-sim.mts <approved|renewed|late|canceled|refunded|chargeback> <email> [--product ID] [--url URL]');
  process.exit(1);
}

const config = JSON.parse(readFileSync(new URL('../apps/desktop/cloud.config.json', import.meta.url), 'utf8')) as { supabaseUrl: string };
const url = flag('url') ?? `${config.supabaseUrl}/functions/v1/kiwify-webhook`;
const product = flag('product') ?? 'sim-product';
const nextPayment = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
const now = new Date().toISOString();

const body = JSON.stringify({
  webhook_event_type: EVENTS[event].type,
  order_id: 'sim-order-1',
  order_status: EVENTS[event].status,
  updated_at: now,
  Customer: { email },
  Product: { product_id: product },
  Subscription: { id: 'sim-sub-1', next_payment: nextPayment },
});

const signature = createHmac('sha1', token).update(body).digest('hex');
const res = await fetch(`${url}?signature=${signature}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body,
});
console.log(res.status, await res.text());
