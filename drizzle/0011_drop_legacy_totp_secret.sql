-- The second factor secret that predated Better Auth.
--
-- This column was written by the hand rolled TOTP that came before the two
-- factor plugin. Nothing has written it since Better Auth arrived, and nothing
-- reads it any more either: the administrators screen was the last caller and
-- now reads auth_two_factors, which is the enrolment a code is actually checked
-- against. A column that is never written and never read is not a spare, it is
-- a second answer to "is this account enrolled" that is wrong in both
-- directions, so it goes.
--
-- Nothing else depends on it. No index, constraint, view or trigger names it.
-- The real secrets live encrypted in auth_two_factors.secret and are untouched.

ALTER TABLE "admin_users" DROP COLUMN "totp_secret";
