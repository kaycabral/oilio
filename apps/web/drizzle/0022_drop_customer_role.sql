-- Drop the vestigial `customer` role from the membership/invite role CHECKs
-- (brief 0068 D4 / #1226 AC-04). The `customer` value never had a write path
-- that created a membership — a client of the org lives in the `customers` table,
-- never as a membership — so the enum value was a Firestore-contract leftover.
-- No data migration: no row carries `role = 'customer'` (nothing produced it).
--
-- A CHECK can't be altered in place, so drop-and-recreate each with the lean set.
-- The DROP guards against environments where the constraint was created under a
-- different name in an earlier migration.

ALTER TABLE "memberships" DROP CONSTRAINT IF EXISTS "memberships_role_check";
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_role_check"
  CHECK ("memberships"."role" IN ('owner', 'manager', 'professional', 'receptionist'));

ALTER TABLE "invites" DROP CONSTRAINT IF EXISTS "invites_role_check";
ALTER TABLE "invites" ADD CONSTRAINT "invites_role_check"
  CHECK ("invites"."role" IN ('owner', 'manager', 'professional', 'receptionist'));
