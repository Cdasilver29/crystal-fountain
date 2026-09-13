-- How a session was opened, "password" or "google".
--
-- Nullable on purpose. Every session that predates this column has no answer,
-- and null reads as "opened before we started recording it" rather than as
-- either method. The portal treats an unknown method the cautious way, as a
-- password session, so an old cookie cannot claim Google's second factor.
--
-- Written once when the session row is created and never updated. Better Auth
-- rolls the idle window forward on use, which touches the row, and a session
-- does not change how it was opened.
--
-- No backfill. Guessing at the method of a session that predates the column
-- would put a value in the audit trail that nobody actually observed, and
-- these rows expire within a day anyway.

ALTER TABLE "auth_sessions" ADD COLUMN "sign_in_method" text;
