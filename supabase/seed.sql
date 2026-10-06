-- LOCAL DEVELOPMENT ONLY. Runs on `supabase db reset`; never apply it to a hosted/production project.
--
-- Creates the developer/admin account dev@editools.local, so everything can be tested locally: sign
-- in with that address and read the 6-digit code in Inbucket (http://127.0.0.1:54324).
--
-- NOT VERIFIED against a running local stack (no Docker where this was written): inserting straight
-- into auth.users/auth.identities is the usual community recipe, but GoTrue's columns change
-- between versions. If sign-in fails for this user, delete it and instead sign in once with that
-- address (the account is then created normally) and run supabase/scripts/promote_admin.sql.

do $$
declare
  dev_id constant uuid := '00000000-0000-4000-8000-0000000000de';
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change
  ) values (
    '00000000-0000-0000-0000-000000000000', dev_id, 'authenticated', 'authenticated',
    'dev@editools.local', '', now(),
    '{"provider": "email", "providers": ["email"]}', '{}', now(), now(),
    '', '', '', ''
  ) on conflict (id) do nothing;

  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (
    gen_random_uuid(), dev_id, dev_id::text,
    jsonb_build_object('sub', dev_id::text, 'email', 'dev@editools.local', 'email_verified', true),
    'email', now(), now(), now()
  ) on conflict do nothing;

  -- The profile row is created by the on_auth_user_created trigger.
  update public.profiles set role = 'admin', consent_analytics = false where id = dev_id;
end;
$$;
