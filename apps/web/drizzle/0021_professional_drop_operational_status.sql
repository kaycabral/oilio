-- Drop `professionals.operational_status` (brief 0068 D4 / #1226 AC-02). The
-- status is no longer materialized on the projection — it is DERIVED on the read
-- layer from real facts (whatsapp present ∧ ≥1 unit ∧ ≥1 service; see
-- `deriveOperationalStatus`). The `professional.activated`/`.suspended` events
-- stop being emitted (the reducer keeps them as no-ops for historical replay).
--
-- Drop the CHECK constraint first, then the column. Replay is unaffected: legacy
-- `professional.created` events carry `operationalStatus` in their payload, but
-- Effect Schema ignores excess properties on decode (a drop needs no
-- normalization).

ALTER TABLE "professionals" DROP CONSTRAINT "professionals_operational_status_check";--> statement-breakpoint
ALTER TABLE "professionals" DROP COLUMN "operational_status";
