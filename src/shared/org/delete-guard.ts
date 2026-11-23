import {
  Appointment,
  Subscription,
  isActiveMembershipStatus,
  isActiveSubscriptionStatus,
  isFutureScheduledAppointment,
} from '@/domain'
import {
  rowToDoc as appointmentRowToDoc,
  type AppointmentRow,
} from '@/shared/db/pg/effect/appointment-projector'
import {
  rowToDoc as subscriptionRowToDoc,
  type SubscriptionRow,
} from '@/shared/db/pg/effect/subscription-projector'
import { readUnderRls } from '@/shared/db/pg/rls-read'
import {
  countMemberOperationsWithUnit,
  getMemberOperationUserId,
} from '@/shared/org/member-operation-read'
import { getMembership } from '@/shared/org/membership'
import { Schema } from 'effect'

const decodeAppointment = Schema.decodeUnknownSync(Appointment)
const decodeSubscription = Schema.decodeUnknownSync(Subscription)

async function readScheduledAppointments(
  orgId: string,
  column: 'member_operation_id' | 'customer_id' | 'unit_id',
  id: string,
): Promise<Appointment[]> {
  const rows = await readUnderRls<AppointmentRow>(orgId, (client) =>
    client
      .query<AppointmentRow>(
        `SELECT * FROM appointments WHERE org_id = $1 AND ${column} = $2 AND status = 'scheduled'`,
        [orgId, id],
      )
      .then((res) => res.rows),
  )
  return rows.map((row) => decodeAppointment(appointmentRowToDoc(row)))
}

async function readSubscriptions(
  orgId: string,
  where: string,
  params: readonly unknown[],
): Promise<Subscription[]> {
  const rows = await readUnderRls<SubscriptionRow>(orgId, (client) =>
    client
      .query<SubscriptionRow>(`SELECT * FROM subscriptions WHERE org_id = $1${where}`, [
        orgId,
        ...params,
      ])
      .then((res) => res.rows),
  )
  return rows.map((row) => decodeSubscription(subscriptionRowToDoc(row)))
}

async function hasFutureScheduledAppointment(
  orgId: string,
  field: 'member_operation_id' | 'customer_id',
  id: string,
): Promise<boolean> {
  const appts = await readScheduledAppointments(orgId, field, id)
  return appts.some((data) => isFutureScheduledAppointment(data))
}

export type WithCanDelete<T> = T & { canDelete: boolean }

export async function attachCanDelete<T extends { id: string }>(
  rows: T[],
  hasActiveReference: (id: string) => Promise<boolean>,
): Promise<WithCanDelete<T>[]> {
  const flags = await Promise.all(rows.map((row) => hasActiveReference(row.id)))
  return rows.map((row, i) => ({ ...row, canDelete: !flags[i] }))
}

export async function planHasActiveReference(orgId: string, planId: string): Promise<boolean> {
  const subs = await readSubscriptions(orgId, ` AND plan->>'planId' = $2`, [planId])
  return subs.some((s) => isActiveSubscriptionStatus(s.status))
}

export async function canDeletePlan(orgId: string, planId: string): Promise<boolean> {
  return !(await planHasActiveReference(orgId, planId))
}

export async function catalogItemHasActiveReference(
  orgId: string,
  catalogItemId: string,
): Promise<boolean> {
  const openRows = await readUnderRls<{ one: number }>(orgId, (client) =>
    client
      .query<{ one: number }>(
        `SELECT 1 AS one FROM orders
           WHERE org_id = $1 AND status = 'open' AND items @> $2::jsonb LIMIT 1`,
        [orgId, JSON.stringify([{ refId: catalogItemId }])],
      )
      .then((res) => res.rows),
  )
  if (openRows.length > 0) return true

  const covering = await readSubscriptions(orgId, ` AND plan->'includedItemIds' @> $2::jsonb`, [
    JSON.stringify([catalogItemId]),
  ])
  return covering.some((s) => isActiveSubscriptionStatus(s.status))
}

export async function canDeleteCatalogItem(orgId: string, catalogItemId: string): Promise<boolean> {
  return !(await catalogItemHasActiveReference(orgId, catalogItemId))
}

export async function unitHasActiveReference(orgId: string, unitId: string): Promise<boolean> {
  if ((await countMemberOperationsWithUnit(orgId, unitId)) > 0) return true

  const appts = await readScheduledAppointments(orgId, 'unit_id', unitId)
  return appts.some((data) => isFutureScheduledAppointment(data))
}

export async function canDeleteUnit(orgId: string, unitId: string): Promise<boolean> {
  return !(await unitHasActiveReference(orgId, unitId))
}

export async function memberOperationHasActiveReference(
  orgId: string,
  memberOperationId: string,
): Promise<boolean> {
  if (await hasFutureScheduledAppointment(orgId, 'member_operation_id', memberOperationId))
    return true

  const userId = await getMemberOperationUserId(orgId, memberOperationId)
  if (!userId) return false

  const member = await getMembership(orgId, userId)
  return member ? isActiveMembershipStatus(member.status) : false
}

export async function canDeleteMemberOperation(
  orgId: string,
  memberOperationId: string,
): Promise<boolean> {
  return !(await memberOperationHasActiveReference(orgId, memberOperationId))
}

export async function customerHasOpenComanda(orgId: string, customerId: string): Promise<boolean> {
  const rows = await readUnderRls<{ one: number }>(orgId, (client) =>
    client
      .query<{ one: number }>(
        `SELECT 1 AS one FROM orders
           WHERE org_id = $1 AND customer_id = $2 AND status = 'open' LIMIT 1`,
        [orgId, customerId],
      )
      .then((res) => res.rows),
  )
  return rows.length > 0
}

export async function canDeleteCustomer(orgId: string, customerId: string): Promise<boolean> {
  return !(await customerHasOpenComanda(orgId, customerId))
}

export type CustomerDeletionImpact = {
  openComandas: number
  activeSubscription: { planName: string; periodEndAt: string } | null
  futureAppointments: number
  hasFootprint: boolean
}

export async function getCustomerDeletionImpact(
  orgId: string,
  customerId: string,
): Promise<CustomerDeletionImpact> {
  const orderStatuses = await readUnderRls<{ status: string }>(orgId, (client) =>
    client
      .query<{
        status: string
      }>('SELECT status FROM orders WHERE org_id = $1 AND customer_id = $2', [orgId, customerId])
      .then((res) => res.rows),
  )
  const openComandas = orderStatuses.filter((o) => o.status === 'open').length

  const subs = await readSubscriptions(orgId, ` AND customer_id = $2`, [customerId])
  const activeSub = subs.find((s) => isActiveSubscriptionStatus(s.status))
  const activeSubscription = activeSub
    ? { planName: activeSub.plan.name, periodEndAt: activeSub.currentPeriod.endAt }
    : null

  const scheduledAppts = await readScheduledAppointments(orgId, 'customer_id', customerId)
  const futureAppointments = scheduledAppts.filter((data) =>
    isFutureScheduledAppointment(data),
  ).length

  let hasFootprint = orderStatuses.length > 0 || subs.length > 0 || scheduledAppts.length > 0
  if (!hasFootprint) {
    const anyAppt = await readUnderRls<{ one: number }>(orgId, (client) =>
      client
        .query<{
          one: number
        }>('SELECT 1 AS one FROM appointments WHERE org_id = $1 AND customer_id = $2 LIMIT 1', [
          orgId,
          customerId,
        ])
        .then((res) => res.rows),
    )
    hasFootprint = anyAppt.length > 0
  }

  return { openComandas, activeSubscription, futureAppointments, hasFootprint }
}
