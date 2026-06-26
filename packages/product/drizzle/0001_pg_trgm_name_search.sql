-- Feature D (brief 0055): typo-tolerant name autocomplete over the sovereign base.
-- Expand-only migration — adds the `pg_trgm` extension + a trigram GIN index on
-- `name`. No column/constraint change, so it is backward-compatible (the GTIN
-- path is untouched). drizzle-kit does not emit `CREATE EXTENSION`, so the
-- extension line is hand-added ABOVE the generated index (the `gin_trgm_ops`
-- operator class the index uses only exists once the extension is installed).
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE INDEX "product_name_trgm_idx" ON "product" USING gin ("name" gin_trgm_ops);