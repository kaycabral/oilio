import { Appointment, Charge, Subscription, type SubscriptionStatus } from '@/domain'
import { AppointmentConfig, ChargeConfig, SubscriptionConfig } from '@/domain/aggregates'
import { aggregateRef } from '@/domain/effect'
import {
  rowToDoc as appointmentRowToDoc,
  type AppointmentRow,
} from '@/shared/db/pg/effect/appointment-projector'
import { rowToDoc as chargeRowToDoc, type ChargeRow } from '@/shared/db/pg/effect/charge-projector'
import {
  rowToDoc as subscriptionRowToDoc,
  type SubscriptionRow,
} from '@/shared/db/pg/effect/subscription-projector'
import { readUnderRls } from '@/shared/db/pg/rls-read'
import { emitEvent } from '@/shared/effect-bridge'
import { Schema } from 'effect'
import 'server-only'

const decodeSubscription = Schema.decodeUnknownSync(Subscription)
const decodeCharge = Schema.decodeUnknownSync(Charge)
const decodeAppointment = Schema.decodeUnknownSync(Appointment)

// CUSTOMER erasure cascade — brief 0032 / #1101 (AC-12 + AC-14, Cenário 7).
//
// When a CUSTOMER is erased (per-org block OR global anonymization), their
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
// Scope: ALWAYS within a single org — all reads start from
// `orgs/{orgId}` (ADR 0004, no cross-org query). The caller decides the
// org set: the per-org block passes the one org; the global
// anonymization path iterates the subject's known orgs and calls this once
// per org.

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
  // Whether the subject had at least one active subscription in this org when
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
// org — the fact the informed-consent warning (AC-12) is built on. Read-only;
// no side effects. An empty `userId` (anonymous walk-in) is always false.
export async function hasActiveSubscriptionInOrg(orgId: string, userId: string): Promise<boolean> {
  if (!userId) return false
  const rows = await readUnderRls<{ one: number }>(orgId, (client) =>
    client
      .query<{ one: number }>(
        `SELECT 1 AS one FROM subscriptions
           WHERE org_id = $1 AND customer_user_id = $2 AND status = ANY($3) LIMIT 1`,
        [orgId, userId, ACTIVE_SUBSCRIPTION_STATUSES],
      )
      .then((res) => res.rows),
  )
  return rows.length > 0
}

// Runs the erasure cascade for `userId` as a CUSTOMER in `orgId`. Idempotent
// + errors surface (AC-14). An empty `userId` is a no-op. Authorization is the
// CALLER's responsibility (mirrors `blockSubjectInOrg`/`anonymizeAccount`).
export async function eraseCustomerCascadeInOrg(
  orgId: string,
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
  const subResult = await cancelActiveSubscriptions(orgId, userId, actor)
  // 3. Future appointments → cancel.
  const cancelledAppointments = await cancelFutureAppointments(orgId, userId, actor)

  return {
    hadActiveSubscription: subResult.hadActive,
    cancelledSubscriptions: subResult.cancelledSubscriptions,
    cancelledCharges: subResult.cancelledCharges,
    cancelledAppointments,
  }
}

// Backend-aware read of the subject's active (forward-effect) subscriptions in
// this org (brief 0061 § Grupo B). Postgres reads the typed projection under RLS
// keyed off `customer_user_id`; Firestore the subcollection. Returns `{ id, sub }`
// pairs so the cancel loop keys the event off the real aggregate id.
async function readActiveSubscriptions(
  orgId: string,
  userId: string,
): Promise<{ id: string; sub: Subscription }[]> {
  const rows = await readUnderRls<SubscriptionRow>(orgId, (client) =>
    client
      .query<SubscriptionRow>(
        'SELECT * FROM subscriptions WHERE org_id = $1 AND customer_user_id = $2 AND status = ANY($3)',
        [orgId, userId, ACTIVE_SUBSCRIPTION_STATUSES],
      )
      .then((res) => res.rows),
  )
  return rows.map((row) => ({ id: row.id, sub: decodeSubscription(subscriptionRowToDoc(row)) }))
}

async function cancelActiveSubscriptions(
  orgId: string,
  userId: string,
  actor: string,
): Promise<{ hadActive: boolean; cancelledSubscriptions: number; cancelledCharges: number }> {
  const subscriptions = await readActiveSubscriptions(orgId, userId)

  let cancelledSubscriptions = 0
  let cancelledCharges = 0
  for (const { id, sub } of subscriptions) {
    // Idempotent: a concurrent/previous run may have already terminated it.
    if (sub.status === 'cancelled' || sub.status === 'cancelled_for_non_payment') continue

    // Hard cut (immediate) — NOT `cancel_scheduled` (soft, at period end). The
    // erasure severs the relationship now; the benefit does not run out the
    // period. Event-first: the reducer projects status='cancelled' + cancelledAt.
    const cancelled = await emitEvent(
      SubscriptionConfig,
      aggregateRef(SubscriptionConfig, orgId, id),
      {
        _tag: 'subscription.cancelled',
        actorId: actor,
        payload: { cancelledBy: actor },
      },
    )
    // Erro à mostra (AC-14): a partial cascade is retryable, never silent.
    if (!cancelled.ok) {
      throw new Error(`Failed to cancel subscription ${id}: ${cancelled.error}`)
    }
    cancelledSubscriptions += 1

    cancelledCharges += await cancelPendingCharges(orgId, id, actor)
  }

  return { hadActive: subscriptions.length > 0, cancelledSubscriptions, cancelledCharges }
}

// Stops every never-collected charge of a subscription (`scheduled`/`recovering`)
// so the recovery/billing loop ends. Past charges (paid/failed/refunded) are
// left untouched — retained, de-identified. Idempotent: an already-`cancelled`
// charge is skipped. Within-org query (allowed).
async function cancelPendingCharges(
  orgId: string,
  subscriptionId: string,
  actor: string,
): Promise<number> {
  const charges = await readChargesForSubscription(orgId, subscriptionId)

  let cancelled = 0
  for (const { id, charge } of charges) {
    if (!PENDING_CHARGE_STATUSES.has(charge.status)) continue

    const now = new Date().toISOString()
    const res = await emitEvent(ChargeConfig, aggregateRef(ChargeConfig, orgId, id), {
      _tag: 'charge.cancelled',
      actorId: actor,
      payload: {
        changes: { status: 'cancelled', lastActorUid: null, updatedAt: now },
      },
    })
    if (!res.ok) throw new Error(`Failed to cancel charge ${id}: ${res.error}`)
    cancelled += 1
  }
  return cancelled
}

// Backend-aware read of every charge of a subscription (brief 0061 § Grupo B).
// Postgres reads the typed projection under RLS; Firestore the subcollection.
// Returns `{ id, charge }` pairs so the cancel loop keys the event off the real
// aggregate id.
async function readChargesForSubscription(
  orgId: string,
  subscriptionId: string,
): Promise<{ id: string; charge: Charge }[]> {
  const rows = await readUnderRls<ChargeRow>(orgId, (client) =>
    client
      .query<ChargeRow>('SELECT * FROM charges WHERE org_id = $1 AND subscription_id = $2', [
        orgId,
        subscriptionId,
      ])
      .then((res) => res.rows),
  )
  return rows.map((row) => ({ id: row.id, charge: decodeCharge(chargeRowToDoc(row)) }))
}

// Cancels the subject's FUTURE appointments in this org (`startAt` ahead of
// now, still `scheduled`). Past appointments are LEFT (retained, neutral). The
// customer footprint per org is small, so we filter the future/scheduled
// subset in memory off the single-field `customerUserId` query — no range index
// needed. Idempotent: an already-cancelled/completed/no-show appointment is
// skipped. Within-org query (allowed).
async function cancelFutureAppointments(
  orgId: string,
  userId: string,
  actor: string,
): Promise<number> {
  // Read the subject's appointments (any status) under RLS, keyed off the
  // denormalized `customer_user_id`; the future/scheduled subset is filtered in
  // memory (the per-customer footprint is small).
  const rows = await readUnderRls<AppointmentRow>(orgId, (client) =>
    client
      .query<AppointmentRow>(
        'SELECT * FROM appointments WHERE org_id = $1 AND customer_user_id = $2',
        [orgId, userId],
      )
      .then((res) => res.rows),
  )
  const appointments = rows.map((row) => ({
    id: row.id,
    appt: decodeAppointment(appointmentRowToDoc(row)),
  }))

  const nowMs = Date.now()
  let cancelled = 0
  for (const { id, appt } of appointments) {
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
    const res = await emitEvent(AppointmentConfig, aggregateRef(AppointmentConfig, orgId, id), {
      _tag: 'appointment.cancelled',
      actorId: actor,
      payload: { cancelledBy: 'system', cancelledAt: now, noticeMinutes },
    })
    if (!res.ok) throw new Error(`Failed to cancel appointment ${id}: ${res.error}`)
    cancelled += 1
  }
  return cancelled
}
