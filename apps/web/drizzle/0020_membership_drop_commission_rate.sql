-- Drop `memberships.commission_rate` (brief 0068 D4 / #1226 AC-01). The column
-- was dead weight: every write path stored `null` literally. The effective
-- commission comes from `professionals.default_commission` and the historical
-- value is snapshotted on the `commissions` ledger (ADR 0010), so there is no
-- projection history to preserve here.
--
-- Replay is unaffected: legacy `membership.created` events carry
-- `commissionRate` in their payload, but Effect Schema ignores excess
-- properties on decode (unlike a rename, a drop needs no normalization), so
-- historical streams replay onto the leaner `Membership` cleanly.

ALTER TABLE "memberships" DROP COLUMN "commission_rate";
