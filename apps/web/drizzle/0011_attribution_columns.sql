-- ════════════════════════════════════════════════════════════════════════════
-- Multi-axis attribution columns (brief 0077 Grupo D — AC-10/AC-11, #1280).
--
-- Greenfield: the [[0001]] `via` only ever travelled as a log argument (no
-- column), so there is no data to migrate. Two homes, two lifetimes:
--   - customers.acquisition  → write-once first-touch (which channel/campaign
--                              created the org relationship).
--   - appointments.attribution → per-booking touch (a returning client's new
--                              channel never clobbers the Customer's acquisition).
--
-- Composite/structural → JSONB (mirrors `commission_snapshot`/`tax_identity`).
-- PII-ZERO by construction (channel + ids only) — safe to read into `track()`.
-- Nullable: pre-existing rows stay null.
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE "appointments" ADD COLUMN "attribution" jsonb;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "acquisition" jsonb;
