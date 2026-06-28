-- ════════════════════════════════════════════════════════════════════════════
-- Hang the operational profile off the membership (brief 0076 AC-02 / AC-05).
--
-- `professionals` (the operational profile: commission, units, services,
-- taxIdentity) gains a `member_id` that references the membership it belongs to
-- via the composite FK `(org_id, member_id) → memberships(org_id, id)` with
-- `ON DELETE cascade`. This kills the drift at the root: a profile cannot exist
-- without its membership, and demoting/removing the membership removes the
-- profile (no orphan row) — what the runtime `BookableProfessional` brand used
-- to paper over is now a DB invariant.
--
-- `member_id` is the membership doc id (`{org_id}_{user_id}`), so the backfill
-- derives it from the existing `(org_id, user_id)` pair. The column is added
-- nullable, backfilled, then constrained NOT NULL — safe over existing rows.
--
-- The FK is DEFERRABLE INITIALLY DEFERRED: the invite-accept saga appends the
-- professional projection within the same ACID tx that creates the membership,
-- and replay reconstructs in event order, so the check must happen at COMMIT,
-- not per-statement (the *-saga-acid pattern, mirroring 0002).
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Add the column nullable, backfill from the membership key ───────────────
ALTER TABLE "professionals" ADD COLUMN "member_id" text;--> statement-breakpoint
UPDATE "professionals" SET "member_id" = "org_id" || '_' || "user_id" WHERE "member_id" IS NULL;--> statement-breakpoint
ALTER TABLE "professionals" ALTER COLUMN "member_id" SET NOT NULL;--> statement-breakpoint

-- ── 2. Non-empty CHECK (mirrors the userId guard) ──────────────────────────────
ALTER TABLE "professionals" ADD CONSTRAINT "professionals_member_id_nonempty" CHECK (char_length(btrim("professionals"."member_id")) > 0);--> statement-breakpoint

-- ── 3. Composite FK to memberships, ON DELETE cascade, deferrable ──────────────
ALTER TABLE "professionals" ADD CONSTRAINT "professionals_member_id_fk" FOREIGN KEY ("org_id","member_id") REFERENCES "public"."memberships"("org_id","id") ON DELETE cascade ON UPDATE no action DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint

-- ── 4. Index supporting the FK + cascade lookups ───────────────────────────────
CREATE INDEX "professionals_org_id_member_id_idx" ON "professionals" USING btree ("org_id","member_id");
