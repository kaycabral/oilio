import { Appointment, Charge, Subscription, type SubscriptionStatus } from '@/domain'
import { AppointmentConfig, ChargeConfig, SubscriptionConfig } from '@/domain/aggregates'
import { getAdminFirestore } from '@/shared/db'
import { fsConverter } from '@/shared/db/converter'
import { emitEvent } from '@/shared/effect-bridge'
import 'server-only'

// CUSTOMER erasure cascade — brief 0032 / #1101 (AC-12 + AC-14, Cenário 7).
//
// When a CUSTOMER is erased (per-tenant block OR global anonymization), their
// operational footprint that has a forward effect must be stopped:
//   1. Any ACTIVE subscription is cancelled immediately (`subscription.cancelled`,
//      hard cut) so future renewals stop.
//   2. The subscription's PENDING charges (`scheduled`/`recovering` — never
//      collected) are cancelled (`charge.cancelled`) so the recovery loop stops.
//      Past charges (paid/failed/refunded) are LEFT as-is — they stay retained
//      and de-identified (resolve to the neutral label via the global anon path).
//   3. Future appointments (`startAt` in the future, still `scheduled`) are
//      cancelled (`appointment.cancelled`). Past appointments are LEFT.
//
// This is a SAGA (CLAUDE.md: "cascata = saga, nunca transação única"): each
// aggregate emits its own event in sequence, errors surface (AC-14 — never a
// silent partial erasure), and every step is IDEMPOTENT (re-running over an
// already-cancelled subscription/charge/appointment is a no-op, never throws or
// double-cancels). The subscription cancel keys off `customerUserId` (the FK the
// subscription/appointment projections denormalize) so it works whether or not
// the customer shadow was already archived by the block.
//
// Scope: ALWAYS within a single tenant — all reads start from
// `tenants/{tenantId}` (ADR 0004, no cross-tenant query). The caller decides the
// tenant set: the per-tenant block passes the one tenant; the global
// anonymization path iterates the subject's known tenants and calls this once
// per tenant.

// Default actor stamped on the cancel events — PII-free, an enum-like marker
// that the cancel was driven by an LGPD erasure. The operator-side customer
// removal (brief 0033, AC-07) reuses this exact forward-effect cascade but
// passes its OWN actor (the operator uid) so the audit never mislabels an
// operational removal as an LGPD erasure (the two relations stay separate —
// mapa Ciclo de Vida e Exclusão).
const ERASURE_ACTOR = 'system:erasure'

// Subscription statuses that still have a forward effect (renew / charge) and so
// must be cut on erasure. `cancelled`/`cancelled_for_non_payment` are already
// terminal — re-running skips them (idempotent).
const ACTIVE_SUBSCRIPTION_STATUSES: readonly SubscriptionStatus[] = [
  'pending',
  'active',
  'past_due',
  'suspended',
]

// Charge statuses that were never collected and still loop — stop them.
// `paid`/`failed`/`refunded`/`cancelled` are left untouched (retained history).
const PENDING_CHARGE_STATUSES = new Set(['scheduled', 'recovering'])

export type EraseCustomerCascadeResult = {
  // Whether the subject had at least one active subscription in this tenant when
  // the cascade ran. Surfaced to the caller so the informed-consent warning
  // (AC-12) can be shown before confirming, and reported post-erasure.
  hadActiveSubscription: boolean
  // Count of subscriptions cancelled by this run (0 when already terminal).
  cancelledSubscriptions: number
  // Count of pending charges stopped by this run.
  cancelledCharges: number
  // Count of future appointments cancelled by this run.
  cancelledAppointments: number
}

// Detects whether the subject currently has an ACTIVE subscription in this
// tenant — the fact the informed-consent warning (AC-12) is built on. Read-only;
// no side effects. An empty `userId` (anonymous walk-in) is always false.
export async function hasActiveSubscriptionInTenant(
  tenantId: string,
  userId: string,
): Promise<boolean> {
  if (!userId) return false
  const snap = await getAdminFirestore()
    .collection('tenants')
    .doc(tenantId)
    .collection('subscriptions')
    .where('customerUserId', '==', userId)
    .where('status', 'in', ACTIVE_SUBSCRIPTION_STATUSES)
    .limit(1)
    .get()
  return !snap.empty
}

// Runs the erasure cascade for `userId` as a CUSTOMER in `tenantId`. Idempotent
// + errors surface (AC-14). An empty `userId` is a no-op. Authorization is the
// CALLER's responsibility (mirrors `blockSubjectInTenant`/`anonymizeAccount`).
export async function eraseCustomerCascadeInTenant(
  tenantId: string,
  userId: string,
  actor: string = ERASURE_ACTOR,
): Promise<EraseCustomerCascadeResult> {
  if (!userId) {
    return {
      hadActiveSubscription: false,
      cancelledSubscriptions: 0,
      cancelledCharges: 0,
      cancelledAppointments: 0,
    }
  }

  // 1 + 2. Active subscriptions → cancel immediately + stop pending charges.
  const subResult = await cancelActiveSubscriptions(tenantId, userId, actor)
  // 3. Future appointments → cancel.
  const cancelledAppointments = await cancelFutureAppointments(tenantId, userId, actor)

  return {
    hadActiveSubscription: subResult.hadActive,
    cancelledSubscriptions: subResult.cancelledSubscriptions,
    cancelledCharges: subResult.cancelledCharges,
    cancelledAppointments,
  }
}

async function cancelActiveSubscriptions(
  tenantId: string,
  userId: string,
  actor: string,
): Promise<{ hadActive: boolean; cancelledSubscriptions: number; cancelledCharges: number }> {
  const db = getAdminFirestore()
  const tenantRef = db.collection('tenants').doc(tenantId)
  const snap = await tenantRef
    .collection('subscriptions')
    .withConverter(fsConverter(Subscription))
    .where('customerUserId', '==', userId)
    .where('status', 'in', ACTIVE_SUBSCRIPTION_STATUSES)
    .get()

  let cancelledSubscriptions = 0
  let cancelledCharges = 0
  for (const doc of snap.docs) {
    const sub = doc.data()
    // Idempotent: a concurrent/previous run may have already terminated it.
    if (sub.status === 'cancelled' || sub.status === 'cancelled_for_non_payment') continue

    // Hard cut (immediate) — NOT `cancel_scheduled` (soft, at period end). The
    // erasure severs the relationship now; the benefit does not run out the
    // period. Event-first: the reducer projects status='cancelled' + cancelledAt.
    const cancelled = await emitEvent(
      SubscriptionConfig,
      `tenants/${tenantId}/subscriptions/${doc.id}`,
      {
        _tag: 'subscription.cancelled',
        actorId: actor,
        payload: { cancelledBy: actor },
      },
    )
    // Erro à mostra (AC-14): a partial cascade is retryable, never silent.
    if (!cancelled.ok) {
      throw new Error(`Failed to cancel subscription ${doc.id}: ${cancelled.error}`)
    }
    cancelledSubscriptions += 1

    cancelledCharges += await cancelPendingCharges(tenantId, doc.id, actor)
  }

  return { hadActive: snap.size > 0, cancelledSubscriptions, cancelledCharges }
}

// Stops every never-collected charge of a subscription (`scheduled`/`recovering`)
// so the recovery/billing loop ends. Past charges (paid/failed/refunded) are
// left untouched — retained, de-identified. Idempotent: an already-`cancelled`
// charge is skipped. Within-tenant query (allowed).
async function cancelPendingCharges(
  tenantId: string,
  subscriptionId: string,
  actor: string,
): Promise<number> {
  const db = getAdminFirestore()
  const snap = await db
    .collection('tenants')
    .doc(tenantId)
    .collection('charges')
    .withConverter(fsConverter(Charge))
    .where('subscriptionId', '==', subscriptionId)
    .get()

  let cancelled = 0
  for (const doc of snap.docs) {
    const charge = doc.data()
    if (!PENDING_CHARGE_STATUSES.has(charge.status)) continue

    const now = new Date().toISOString()
    const res = await emitEvent(ChargeConfig, `tenants/${tenantId}/charges/${doc.id}`, {
      _tag: 'charge.cancelled',
      actorId: actor,
      payload: {
        changes: { status: 'cancelled', lastActorUid: null, updatedAt: now },
      },
    })
    if (!res.ok) throw new Error(`Failed to cancel charge ${doc.id}: ${res.error}`)
    cancelled += 1
  }
  return cancelled
}

// Cancels the subject's FUTURE appointments in this tenant (`startAt` ahead of
// now, still `scheduled`). Past appointments are LEFT (retained, neutral). The
// customer footprint per tenant is small, so we filter the future/scheduled
// subset in memory off the single-field `customerUserId` query — no range index
// needed. Idempotent: an already-cancelled/completed/no-show appointment is
// skipped. Within-tenant query (allowed).
async function cancelFutureAppointments(
  tenantId: string,
  userId: string,
  actor: string,
): Promise<number> {
  const db = getAdminFirestore()
  const snap = await db
    .collection('tenants')
    .doc(tenantId)
    .collection('appointments')
    .withConverter(fsConverter(Appointment))
    .where('customerUserId', '==', userId)
    .get()

  const nowMs = Date.now()
  let cancelled = 0
  for (const doc of snap.docs) {
    const appt = doc.data()
    if (appt.status !== 'scheduled') continue
    if (new Date(appt.startAt).getTime() <= nowMs) continue

    const now = new Date().toISOString()
    // Notice is the lead time to the appointment — tracked regardless of policy
    // (same convention as the staff cancel). `cancelledBy: 'system'` marks the
    // erasure-driven cancel, distinct from staff/customer.
    const noticeMinutes = Math.max(
      0,
      Math.round((new Date(appt.startAt).getTime() - nowMs) / 60000),
    )
    const res = await emitEvent(AppointmentConfig, `tenants/${tenantId}/appointments/${doc.id}`, {
      _tag: 'appointment.cancelled',
      actorId: actor,
      payload: { cancelledBy: 'system', cancelledAt: now, noticeMinutes },
    })
    if (!res.ok) throw new Error(`Failed to cancel appointment ${doc.id}: ${res.error}`)
    cancelled += 1
  }
  return cancelled
}
