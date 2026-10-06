-- Promotes an existing account to admin (dev tools, and later the admin dashboard).
--
-- There is deliberately no API or UI path to become an admin: run this by hand in the Supabase SQL
-- editor (production) or psql (local). The person must have signed in at least once so that the
-- account exists. Replace the address below, run it, and check that exactly 1 row was updated.

update public.profiles p
set role = 'admin'
from auth.users u
where p.id = u.id
  and lower(u.email) = lower('YOU@EXAMPLE.COM');

-- To revoke:
--   update public.profiles p set role = 'user' from auth.users u
--   where p.id = u.id and lower(u.email) = lower('YOU@EXAMPLE.COM');
