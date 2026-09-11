-- Lookup attempts on /redeem, for the rate limit.
--
-- Counted from the database rather than from memory, so ten an IP a minute
-- holds across every serverless instance and survives a redeploy. Both
-- successes and failures are recorded: a limiter counting only failures would
-- let somebody who has found one real pledge walk the rest at full speed.
--
-- Nothing here identifies a pledge. The row is an address and a timestamp, so
-- the limiter cannot itself become a record of who looked up whom.

CREATE TABLE "pledge_lookups" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"ip" "inet",
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"found" boolean NOT NULL
);
--> statement-breakpoint
CREATE INDEX "pledge_lookups_ip_at_idx" ON "pledge_lookups" USING btree ("ip","at");