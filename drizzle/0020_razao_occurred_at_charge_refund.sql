ALTER TABLE "charges" ADD COLUMN "refunded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "occurred_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "events_org_id_occurred_at_idx" ON "events" USING btree ("org_id","occurred_at");--> statement-breakpoint
-- Self-heal any pre-existing violator BEFORE adding the CHECKs, so the plain
-- (non-NOT VALID) constraint validation never aborts the deploy. A legacy `paid`
-- charge projection row with NULL paid_at (written before paid_at was populated)
-- would otherwise fail the ALTER. Backfill with `updated_at` — the best available
-- realization-time proxy for such a row. Idempotent (only touches NULLs) and
-- typically ~0 rows; it makes the migration safe regardless of projection state.
UPDATE "charges" SET "paid_at" = "updated_at" WHERE "status" = 'paid' AND "paid_at" IS NULL;--> statement-breakpoint
UPDATE "charges" SET "refunded_at" = "updated_at" WHERE "status" = 'refunded' AND "refunded_at" IS NULL;--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_paid_requires_paid_at" CHECK ("charges"."status" <> 'paid' OR "charges"."paid_at" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_refunded_requires_refunded_at" CHECK ("charges"."status" <> 'refunded' OR "charges"."refunded_at" IS NOT NULL);--> statement-breakpoint
-- Backfill occurred_at (competência) for existing financial events (ADR 0016 D4).
-- Mirrors the domain `competenceOf`: derive the accrual date from the envelope
-- payload per event type. Non-financial events keep occurred_at NULL. Idempotent
-- (only fills NULLs). oilio is in production: pre-D5 closed/reopened/charge events
-- are absent (verified against prod: order_closed=0, order_reopened=0,
-- charge_evts=0), but `commission.created` events DO exist (generated on every
-- order close) — the commission backfill below is load-bearing so legacy
-- commissions land in the Razão's competence window (their CSP would otherwise be
-- invisible). Its competência is `data.createdAt` (= the order's closedAt).
UPDATE "events" SET "occurred_at" = ("envelope" #>> '{payload,closedAt}')::timestamptz
  WHERE "occurred_at" IS NULL AND "envelope" ->> '_tag' = 'order.closed'
    AND "envelope" #>> '{payload,closedAt}' IS NOT NULL;--> statement-breakpoint
UPDATE "events" SET "occurred_at" = ("envelope" #>> '{payload,data,createdAt}')::timestamptz
  WHERE "occurred_at" IS NULL AND "envelope" ->> '_tag' = 'commission.created'
    AND "envelope" #>> '{payload,data,createdAt}' IS NOT NULL;--> statement-breakpoint
UPDATE "events" SET "occurred_at" = ("envelope" #>> '{payload,reopenedAt}')::timestamptz
  WHERE "occurred_at" IS NULL AND "envelope" ->> '_tag' = 'order.reopened'
    AND "envelope" #>> '{payload,reopenedAt}' IS NOT NULL;--> statement-breakpoint
UPDATE "events" SET "occurred_at" = ("envelope" #>> '{payload,changes,periodStartAt}')::timestamptz
  WHERE "occurred_at" IS NULL AND "envelope" ->> '_tag' = 'charge.succeeded'
    AND "envelope" #>> '{payload,changes,periodStartAt}' IS NOT NULL;--> statement-breakpoint
UPDATE "events" SET "occurred_at" = ("envelope" #>> '{payload,changes,refundedAt}')::timestamptz
  WHERE "occurred_at" IS NULL AND "envelope" ->> '_tag' = 'charge.refunded'
    AND "envelope" #>> '{payload,changes,refundedAt}' IS NOT NULL;