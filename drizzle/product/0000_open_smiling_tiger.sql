CREATE TYPE "public"."product_source" AS ENUM('official', 'external', 'org-contributed');--> statement-breakpoint
CREATE TABLE "product" (
	"gtin14" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"brand" text,
	"photo_url" text,
	"measures" jsonb,
	"ncm" text,
	"cest" text,
	"utrib" text,
	"category" text,
	"source" "product_source" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_gtin14_is_14_digits" CHECK ("product"."gtin14" ~ '^[0-9]{14}$'),
	CONSTRAINT "product_name_not_blank" CHECK (length(btrim("product"."name")) > 0)
);
