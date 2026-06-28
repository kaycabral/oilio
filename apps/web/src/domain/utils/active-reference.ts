// Pure predicates that define what counts as an **active reference** to a piece
// of master data (subscription-plan, catalog-item, unit, ...) — brief 0033,
// AC-01. The destructive-action guard blocks a hard-delete ONLY on an active
// reference; a **historical** reference (cancelled subscription, completed/
// cancelled appointment, closed/cancelled order) does NOT block, because
// snapshot-on-use (ADR 0010 D3/D5) already froze the master data into the
// transactional record so deleting the definition never loses history.
//
// These functions are I/O-free so the SAME definition runs in three places:
// 1. the server-action delete guard (authorization of the write),
// 2. the read/list layer that precomputes the per-row `canDelete` flag (#1070),
// 3. unit/integration tests.
//
// Keeping the predicate here (not inlined per call-site) is what guarantees the
// UI's `canDelete` and the server's rejection can never drift apart.

import type { AppointmentStatus } from '../types/appointment'
import type { MembershipStatus } from '../types/enums'
import type { OrderStatus } from '../types/order'
import type { SubscriptionStatus } from '../types/subscription'

// A subscription holds an **active** reference to its plan while it is not yet
// terminal. Terminal = voluntarily cancelled or auto-cancelled for non-payment;
// those are historical and the plan snapshot (`plan.*`) keeps them resolvable.
// Mirrors the cancellable set in `subscription-self-cancel.ts` (pending/active/
// past_due/suspended are all "live" — the customer still has, or is recovering,
// access).
const ACTIVE_SUBSCRIPTION_STATUSES: ReadonlySet<SubscriptionStatus> = new Set([
  'pending',
  'active',
  'past_due',
  'suspended',
])

export function isActiveSubscriptionStatus(status: SubscriptionStatus): boolean {
  return ACTIVE_SUBSCRIPTION_STATUSES.has(status)
}

// An order holds an **active** reference to a catalog item only while it is
// still open (the line items haven't been settled). A closed or cancelled order
// is historical — its `OrderItem` snapshots froze name/price/commission, so the
// catalog item can be hard-deleted without losing the financial record.
export function isActiveOrderStatus(status: OrderStatus): boolean {
  return status === 'open'
}

// An appointment holds an **active** reference to its unit / memberOperation /
// service while it is still `scheduled` AND lies in the future. A completed,
// cancelled or no-show appointment is historical; a past `scheduled` slot is
// also treated as historical (it already happened — nothing future depends on
// the master data staying alive). The appointment snapshots price/duration/
// commission so the history survives a delete.
export function isFutureScheduledAppointment(
  appointment: { status: AppointmentStatus; startAt: string },
  now: Date = new Date(),
): boolean {
  if (appointment.status !== 'scheduled') return false
  return new Date(appointment.startAt).getTime() > now.getTime()
}

// A membership holds an **active** reference to its member (memberOperation) while
// it has NOT been terminally severed. Offboarding (brief 0041) sets the terminal
// `revoked` status to end the employment vínculo; that is the historical state
// and does NOT block a hard-delete. Every other status (`active`, `invited`,
// `suspended` — the reversible 0029 deactivation) means the member is still on
// the team, a live dependency, so the memberOperation projection can't be
// hard-deleted: the lifecycle path is deactivate/offboard, not erase.
export function isActiveMembershipStatus(status: MembershipStatus): boolean {
  return status !== 'revoked'
}
