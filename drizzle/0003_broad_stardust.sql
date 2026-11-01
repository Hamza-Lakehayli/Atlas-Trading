ALTER TABLE "invoices" DROP CONSTRAINT "invoices_total_ck";--> statement-breakpoint
ALTER TABLE "invoices" DROP CONSTRAINT "invoices_cogs_ck";--> statement-breakpoint
ALTER TABLE "payments" DROP CONSTRAINT "payments_amount_ck";--> statement-breakpoint
ALTER TABLE "stock_movements" ALTER COLUMN "created_by" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_total_ck" CHECK ("invoices"."total_minor" > 0);--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_cogs_ck" CHECK ("invoices"."cogs_minor" >= 0);--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_ck" CHECK ("payments"."amount_minor" > 0);