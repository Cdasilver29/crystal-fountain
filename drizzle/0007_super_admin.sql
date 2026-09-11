-- The super administrator, and forced password changes.
--
-- One account is the one the whole portal answers to: it cannot be deactivated
-- or deleted by anybody, it is the only one that can create another
-- administrator, change the campaign settings or delete a pledge, and it is the
-- account that resets everybody else's password. The partial unique index below
-- is what makes "one" true, rather than application code remembering to check.

ALTER TABLE "admin_users" ADD COLUMN "is_super" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Set when somebody else has reset this account's password. A temporary
-- password is known to whoever generated it, so an account carrying one is not
-- yet its owner's, and every admin page sends them to change it first.
ALTER TABLE "admin_users" ADD COLUMN "force_password_change" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- The administrator who was here first is the super administrator.
--
-- On a database that already has one, that is whoever came through
-- /admin/setup: the earliest admin row there is. On an empty one this updates
-- nothing and the setup service sets the flag when the first admin is created.
update admin_users
set is_super = true
where id = (
  select id
  from admin_users
  where role = 'admin'
  order by created_at, id
  limit 1
);
--> statement-breakpoint
CREATE UNIQUE INDEX "admin_users_one_super_idx" ON "admin_users" USING btree ("is_super") WHERE is_super;--> statement-breakpoint
-- A super admin is an admin. Any other combination is a mistake, and one that
-- would quietly hand super powers to an account whose role says viewer.
ALTER TABLE "admin_users" ADD CONSTRAINT "admin_users_super_is_admin_check" CHECK (not "admin_users"."is_super" or "admin_users"."role" = 'admin');
