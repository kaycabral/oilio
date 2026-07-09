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

const ERASURE_ACTOR = 'system:erasure'

const ACTIVE_SUBSCRIPTION_STATUSES: readonly SubscriptionStatus[] = ['active', 'past_due']

const PENDING_CHARGE_STATUSES = new Set(['scheduled', 'recovering'])

export type EraseCustomerCascadeResult = {
  hadActiveSubscription: boolean
  cancelledSubscriptions: number
  cancelledCharges: number
  cancelledAppointments: number
}

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

  const subResult = await cancelActiveSubscriptions(orgId, userId, actor)
  const cancelledAppointments = await cancelFutureAppointments(orgId, userId, actor)

  return {
    hadActiveSubscription: subResult.hadActive,
    cancelledSubscriptions: subResult.cancelledSubscriptions,
    cancelledCharges: subResult.cancelledCharges,
    cancelledAppointments,
  }
}

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
    if (sub.status === 'cancelled' || sub.status === 'cancelled_for_non_payment') continue

    const cancelled = await emitEvent(
      SubscriptionConfig,
      aggregateRef(SubscriptionConfig, orgId, id),
      {
        _tag: 'subscription.cancelled',
        actorId: actor,
        payload: { cancelledBy: actor },
      },
    )
    if (!cancelled.ok) {
      throw new Error(`Failed to cancel subscription ${id}: ${cancelled.error}`)
    }
    cancelledSubscriptions += 1

    cancelledCharges += await cancelPendingCharges(orgId, id, actor)
  }

  return { hadActive: subscriptions.length > 0, cancelledSubscriptions, cancelledCharges }
}

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

async function cancelFutureAppointments(
  orgId: string,
  userId: string,
  actor: string,
): Promise<number> {
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
