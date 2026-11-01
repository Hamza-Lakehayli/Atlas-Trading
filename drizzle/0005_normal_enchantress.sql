DROP INDEX "idempotency_org_operation_key_uidx";--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD COLUMN "actor_id" text;--> statement-breakpoint
UPDATE "idempotency_keys" AS ik SET "actor_id" = COALESCE(
  (SELECT al."actor_id" FROM "audit_log" AS al WHERE al."organization_id" = ik."organization_id" AND al."entity_id" = ik."resource_id" ORDER BY al."at" ASC LIMIT 1),
  (SELECT so."created_by" FROM "sales_orders" AS so WHERE so."organization_id" = ik."organization_id" AND so."id" = ik."resource_id"),
  (SELECT p."recorded_by" FROM "payments" AS p WHERE p."organization_id" = ik."organization_id" AND p."id" = ik."resource_id")
) WHERE ik."actor_id" IS NULL;--> statement-breakpoint
DO $$ BEGIN IF EXISTS (SELECT 1 FROM "idempotency_keys" WHERE "actor_id" IS NULL) THEN RAISE EXCEPTION 'Cannot safely backfill idempotency actor; reconcile legacy rows before migration'; END IF; END $$;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ALTER COLUMN "actor_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_org_actor_operation_key_uidx" ON "idempotency_keys" USING btree ("organization_id","actor_id","operation","key");
