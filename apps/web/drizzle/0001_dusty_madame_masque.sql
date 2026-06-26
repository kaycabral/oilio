CREATE TABLE "catalog_items" (
	"aggregate_path" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"id" text NOT NULL,
	"version" bigint NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"category_id" text,
	"price_cents" bigint NOT NULL,
	"price_visibility" text NOT NULL,
	"active" boolean NOT NULL,
	"archived_at" text,
	"duration_minutes" bigint,
	"sku" text,
	"stock" bigint,
	"gtin14" text,
	"reconciliation_pending" boolean,
	"reconciliation_last_attempt" text,
	"commission" jsonb,
	"unit_ids" jsonb NOT NULL,
	"unit_overrides" jsonb,
	"required_resources" jsonb,
	"public_visible" boolean NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "catalog_items_kind_check" CHECK ("catalog_items"."kind" IN ('service', 'product')),
	CONSTRAINT "catalog_items_name_nonempty" CHECK (char_length(btrim("catalog_items"."name")) > 0),
	CONSTRAINT "catalog_items_price_cents_nonneg" CHECK ("catalog_items"."price_cents" >= 0),
	CONSTRAINT "catalog_items_price_visibility_check" CHECK ("catalog_items"."price_visibility" IN ('visible', 'on_request')),
	CONSTRAINT "catalog_items_kind_shape" CHECK ((
        "catalog_items"."kind" = 'service'
        AND "catalog_items"."duration_minutes" IS NOT NULL
        AND "catalog_items"."sku" IS NULL
        AND "catalog_items"."stock" IS NULL
        AND "catalog_items"."gtin14" IS NULL
        AND "catalog_items"."reconciliation_pending" IS NULL
        AND "catalog_items"."reconciliation_last_attempt" IS NULL
      ) OR (
        "catalog_items"."kind" = 'product'
        AND "catalog_items"."duration_minutes" IS NULL
        AND "catalog_items"."stock" IS NOT NULL
      ))
);
--> statement-breakpoint
CREATE INDEX "catalog_items_org_id_name_idx" ON "catalog_items" USING btree ("org_id","name");--> statement-breakpoint
CREATE INDEX "catalog_items_org_id_active_idx" ON "catalog_items" USING btree ("org_id","active");