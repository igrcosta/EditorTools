# Editools cloud backend (Supabase)

Accounts, plans, the daily quota, and (next increments) Kiwify billing and usage analytics. The
desktop app's local server is the only client: it signs users in, asks for entitlements and
reserves quota here. The renderer never talks to Supabase.

```
migrations/    schema, RLS, functions (forward-only)
functions/     Edge Functions (Deno): get-entitlements, delete-account
templates/     sign-in e-mail (must contain the 6-digit code)
scripts/       promote_admin.sql
seed.sql       LOCAL ONLY: dev@editools.local (admin)
tests/         SQL behaviour tests (run by `npm test`, via PGlite)
```

## What is verified, and what is not

Verified by `npm test`: every migration runs on a real Postgres engine (PGlite); quota, release,
day rollover, plan expiry, pending-purchase claiming, RLS isolation, privilege checks, consent,
export, admin gating and the local seed; and the limits signature (signed with the Edge Function's
code, verified with the server's).

**Not verified** (needs Docker + the Supabase CLI, which were not available): `supabase start`,
GoTrue itself (the sign-in e-mail, the `seed.sql` insert into `auth.users`), the Edge Functions
running on Deno (they are syntax-checked only), pg_cron, true parallel calls to `reserve_run`
(the advisory lock), and the real Supabase role/grant defaults. Run the checklist below once.

## Local development

1. Install Docker Desktop and the [Supabase CLI](https://supabase.com/docs/guides/cli).
2. `supabase start` then `supabase db reset` (applies migrations and `seed.sql`).
3. Serve the functions with a local secret file (`supabase/.env`, git-ignored):
   `LIMITS_PRIVATE_KEY=<see "Signing keys">` then `supabase functions serve --env-file supabase/.env`.
4. Run the app with the local values (the CLI prints them):
   `SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_ANON_KEY=<anon key> LIMITS_PUBLIC_KEY=<public key> npm run desktop:dev`
5. Sign in as `dev@editools.local`; the code arrives in Inbucket at http://127.0.0.1:54324.
   If the seeded user cannot sign in, see the note in `seed.sql`.

## Hosted project (production)

1. Create a project in **South America (São Paulo)** (LGPD data locality). Use **Pro** before launch:
   Free pauses after a week of inactivity. Configure **custom SMTP** (a sending domain with SPF/DKIM)
   or the sign-in codes will be rate-limited/spam-filtered.
2. Authentication > Email Templates: paste `templates/otp.html` into **both** "Confirm signup" and
   "Magic Link" (a new address gets the first, an existing one the second; both need `{{ .Token }}`).
   Authentication > Providers > Email: keep "Confirm email" off for OTP; set OTP length 6.
3. `supabase link --project-ref <ref>` and `supabase db push`.
4. Secrets: `supabase secrets set LIMITS_PRIVATE_KEY=...`, then `supabase functions deploy get-entitlements delete-account`.
   (`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are provided to functions by Supabase.)
5. Put the project URL, the **anon** key and the **public** signing key in `apps/desktop/cloud.config.json`.
   The service-role key and the private signing key never go in the repo, the installer or any config file.
6. First admin: sign in once with your own address, then run `scripts/promote_admin.sql` in the SQL editor.

## Signing keys (offline plan limits)

The cloud signs each user's plan limits so the app can keep enforcing them offline for 7 days.

```bash
node -e "const {generateKeyPairSync}=require('crypto');const p=generateKeyPairSync('ed25519');console.log('LIMITS_PRIVATE_KEY (Edge secret, never commit):\n'+p.privateKey.export({type:'pkcs8',format:'der'}).toString('base64'));console.log('\nLIMITS_PUBLIC_KEY (goes in the app):\n'+p.publicKey.export({type:'spki',format:'der'}).toString('base64'))"
```

Without `LIMITS_PUBLIC_KEY` the app still works but has **no offline grace** (it needs the network).

## Data and LGPD notes

- Deleting an account (`delete-account`) removes the auth user and everything that cascades from it
  (profile, subscriptions, usage), removes unclaimed purchases for that e-mail, and **anonymises**
  analytics events. `kiwify_events` (the raw payment log) is kept for accounting/tax purposes: say so
  in the privacy policy.
- `export_my_data()` returns everything stored about the caller as one JSON document.
- Rolling back: migrations are forward-only. Take a backup before each production `db push`.

## Kiwify (subscriptions)

Code: `packages/shared/src/kiwify.ts` (payload reading + state machine), `functions/kiwify-webhook`,
`functions/_shared/kiwify-signature.ts`, migration `20261007100000_kiwify.sql`, simulator
`scripts/kiwify-sim.mts`.

1. Create the product in Kiwify: recurring subscription, delivery format "Quero apenas processar
   pagamentos", card + Pix + boleto. Pix/boleto renew manually; Kiwify waits 5 days after the due date
   and then cancels (the app's grace is the same 5 days).
2. Apps > Webhooks: URL `https://<project-ref>.supabase.co/functions/v1/kiwify-webhook`, enable the
   purchase-approved, renewed, late, canceled, refunded and chargeback events, and copy the webhook
   token. The token is a secret: it goes only into Supabase (never the repo, a chat or a config file).
3. `supabase secrets set "KIWIFY_WEBHOOK_TOKEN=..." "KIWIFY_PRODUCT_IDS=<product id>"` (comma-separated
   ids; **empty grants nothing**), then `supabase db push` and
   `supabase functions deploy kiwify-webhook --no-verify-jwt --use-api`.
4. Test without paying: `KIWIFY_WEBHOOK_TOKEN=... npx tsx scripts/kiwify-sim.mts approved you@mail.com --product <id>`
   then `late`, `canceled`, `refunded`. The app shows the change on the next window focus.

**Unverified until real deliveries are captured** (Apps > Webhooks > logs, one card and one Pix
purchase): exact event names, whether the payload has a subscription id, the date format/time zone,
and whether `signature` signs the raw body or re-serialised JSON (both are accepted; `kiwify_events.signature_mode`
records which matched — then keep only that one). Rejected deliveries are stored only with
`KIWIFY_LOG_REJECTED=1`.
