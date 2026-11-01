ALTER TABLE "sales_order_lines" DROP CONSTRAINT "sales_order_lines_price_ck";--> statement-breakpoint
ALTER TABLE "sales_order_lines" DROP CONSTRAINT "sales_order_lines_cost_ck";--> statement-breakpoint
ALTER TABLE "stock_movements" DROP CONSTRAINT "stock_movements_cost_ck";--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_price_ck" CHECK ("sales_order_lines"."unit_price_minor" >= 0);--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_cost_ck" CHECK ("sales_order_lines"."unit_cost_at_sale_minor" IS NULL OR "sales_order_lines"."unit_cost_at_sale_minor" >= 0);--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_cost_ck" CHECK ("stock_movements"."unit_cost_minor" >= 0);