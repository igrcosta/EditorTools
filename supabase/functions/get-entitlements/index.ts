// get-entitlements: what the signed-in user's plan allows, plus a copy of the limits signed with
// the cloud's private key so the desktop app can keep enforcing per-job limits while offline.
//
// Called by the app's local server with the USER's access token (verify_jwt = true). The user and
// the entitlements both come from the database/GoTrue using that same token, so a caller can only
// ever receive their own account.
//
// Secrets: LIMITS_PRIVATE_KEY (Ed25519, base64 PKCS#8). SUPABASE_URL and SUPABASE_ANON_KEY are
// provided to every Edge Function by Supabase. The service-role key is NOT needed here.

import { OFFLINE_GRACE_SECONDS, type Entitlements } from '../../../packages/shared/src/plans.ts';
import { importSigningKey, signLimits } from '../_shared/limits-signing.ts';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let signingKey: ReturnType<typeof importSigningKey> | null = null;

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const authorization = req.headers.get('Authorization') ?? '';
  if (!authorization.startsWith('Bearer ')) return json({ error: 'unauthenticated' }, 401);

  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const privateKey = Deno.env.get('LIMITS_PRIVATE_KEY');
  if (!url || !anonKey || !privateKey) return json({ error: 'not_configured' }, 500);

  const headers = { apikey: anonKey, Authorization: authorization };
  const [userRes, entitlementsRes] = await Promise.all([
    fetch(`${url}/auth/v1/user`, { headers }),
    fetch(`${url}/rest/v1/rpc/get_entitlements`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: '{}',
    }),
  ]);
  if (!userRes.ok || !entitlementsRes.ok) return json({ error: 'unauthenticated' }, 401);

  const user = (await userRes.json()) as { id: string };
  const entitlements = (await entitlementsRes.json()) as Entitlements;

  // Paid limits must not outlive the paid period: cap the offline validity at access_until.
  let graceSeconds = OFFLINE_GRACE_SECONDS;
  if (entitlements.accessUntil) {
    const secondsLeft = Math.floor((Date.parse(entitlements.accessUntil) - Date.now()) / 1000);
    graceSeconds = Math.max(60, Math.min(OFFLINE_GRACE_SECONDS, secondsLeft));
  }

  signingKey ??= importSigningKey(privateKey);
  const signed = await signLimits(await signingKey, {
    sub: user.id,
    plan: entitlements.plan,
    limits: entitlements.limits,
    graceSeconds,
  });

  return json({ entitlements, signed });
});
