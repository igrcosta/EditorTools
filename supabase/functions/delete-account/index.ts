// delete-account: LGPD erasure. Deletes the caller's account and personal data.
//
// The caller is identified with THEIR OWN token (verify_jwt = true, and re-checked against GoTrue
// below); the service-role key is used only to perform the deletion, and the target is always the
// id GoTrue returns for that token — never anything from the request body.
//
// Removes: the auth user (cascades to profile, subscriptions, usage counters and reservations) and
// any unclaimed purchase kept for their e-mail. Analytics events are ANONYMISED, not deleted
// (user_id/device_id/session_id set to null), so aggregate statistics survive.
// Deliberately kept: kiwify_events (raw payment-provider log), which may be needed for accounting
// and tax obligations — the privacy policy must say so.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response(null, { status: 405 });

  const authorization = req.headers.get('Authorization') ?? '';
  if (!authorization.startsWith('Bearer ')) return new Response(null, { status: 401 });

  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !anonKey || !serviceKey) return new Response(null, { status: 500 });

  const userRes = await fetch(`${url}/auth/v1/user`, { headers: { apikey: anonKey, Authorization: authorization } });
  if (!userRes.ok) return new Response(null, { status: 401 });
  const user = (await userRes.json()) as { id?: string; email?: string };
  if (!user.id || !UUID.test(user.id)) return new Response(null, { status: 401 });

  const admin = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };

  const anonymise = await fetch(`${url}/rest/v1/events?user_id=eq.${user.id}`, {
    method: 'PATCH',
    headers: { ...admin, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ user_id: null, device_id: null, session_id: null }),
  });
  if (!anonymise.ok) return new Response(null, { status: 502 });

  if (user.email) {
    const email = encodeURIComponent(user.email.trim().toLowerCase());
    const pending = await fetch(`${url}/rest/v1/pending_entitlements?email_norm=eq.${email}`, {
      method: 'DELETE',
      headers: { ...admin, Prefer: 'return=minimal' },
    });
    if (!pending.ok) return new Response(null, { status: 502 });
  }

  const deleted = await fetch(`${url}/auth/v1/admin/users/${user.id}`, { method: 'DELETE', headers: admin });
  if (!deleted.ok) return new Response(null, { status: 502 });

  return new Response(null, { status: 204 });
});
