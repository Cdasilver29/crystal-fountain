ALTER TABLE "pledge_increments" ADD COLUMN "status" text DEFAULT 'applied' NOT NULL;--> statement-breakpoint
ALTER TABLE "pledge_increments" ADD COLUMN "decided_by" uuid;--> statement-breakpoint
ALTER TABLE "pledge_increments" ADD COLUMN "decided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pledge_increments" ADD CONSTRAINT "pledge_increments_decided_by_admin_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pledge_increments_held_idx" ON "pledge_increments" USING btree ("created_at") WHERE status = 'held';--> statement-breakpoint
ALTER TABLE "pledge_increments" ADD CONSTRAINT "pledge_increments_status_check" CHECK ("pledge_increments"."status" in ('applied','held','confirmed','rejected'));--> statement-breakpoint
ALTER TABLE "pledge_increments" ADD CONSTRAINT "pledge_increments_held_is_public_check" CHECK ("pledge_increments"."status" = 'applied' or ("pledge_increments"."channel" = 'web' and "pledge_increments"."amount_minor" > 0));--> statement-breakpoint
ALTER TABLE "pledge_increments" ADD CONSTRAINT "pledge_increments_decided_check" CHECK (("pledge_increments"."status" in ('confirmed','rejected')) = ("pledge_increments"."decided_at" is not null)
          and ("pledge_increments"."status" not in ('confirmed','rejected') or "pledge_increments"."decided_by" is not null));--> statement-breakpoint
-- The invariant now counts applied increments only.
--
-- A held addition is recorded but is not part of the pledge until the
-- treasurer confirms it, so a pledge's amount must equal the sum of its
-- applied increments and nothing else. Without this, recording a held
-- addition would break the commit the moment it was written.
--
-- The same function body as migration 0005 in every other respect, including
-- the separate branches for the two tables and the early return when the
-- pledge was removed later in the same transaction. The two constraint
-- triggers already call it and stay deferred; replacing the function is
-- enough, and changing a status fires them too because they are declared on
-- every update of pledge_increments.
create or replace function assert_pledge_matches_increments()
returns trigger
language plpgsql
as $$
declare
  v_pledge_id uuid;
  v_amount    bigint;
  v_sum       bigint;
begin
  if tg_table_name = 'pledges' then
    if tg_op = 'DELETE' then
      v_pledge_id := old.id;
    else
      v_pledge_id := new.id;
    end if;
  else
    if tg_op = 'DELETE' then
      v_pledge_id := old.pledge_id;
    else
      v_pledge_id := new.pledge_id;
    end if;
  end if;

  select amount_minor into v_amount from pledges where id = v_pledge_id;

  if not found then
    return null;
  end if;

  select coalesce(sum(amount_minor), 0) into v_sum
  from pledge_increments
  where pledge_id = v_pledge_id
    and status = 'applied';

  if v_sum <> v_amount then
    raise exception
      'Pledge % carries amount_minor % but its applied increments total % minor units',
      v_pledge_id, v_amount, v_sum
      using errcode = 'check_violation';
  end if;

  return null;
end;
$$;
