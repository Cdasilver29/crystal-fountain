CREATE TABLE "public_list_requests" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"ip" "inet",
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "public_list_requests_ip_at_idx" ON "public_list_requests" USING btree ("ip","at");