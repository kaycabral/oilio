import {
  Appointment,
  DEFAULT_UNIT_TIMEZONE,
  Subscription,
  canCustomerCancelAppointment,
  canCustomerCancelSubscription,
  normalizeCancellationPolicy,
  type CatalogItem,
  type MemberOperation,
  type Order,
  type Org,
  type StoredUnit,
} from '@/domain'
import { appointmentPriceLabel } from '@/features/me/core/appointment-price'
import { describeCancelReason } from '@/features/me/core/cancel-notice'
import type { AppointmentRowData } from '@/features/me/ui/AppointmentRow'
import type { SubscriptionRowData } from '@/features/me/ui/SubscriptionRow'
import { loadClosedOrdersByAppointmentForOrg } from '@/features/orders/adapters/order-financial-read'
import { listCatalogItems } from '@/shared/db/effect/catalog-item-read'
import {
  rowToDoc as appointmentRowToDoc,
  type AppointmentRow,
} from '@/shared/db/pg/effect/appointment-projector'
import {
  rowToDoc as subscriptionRowToDoc,
  type SubscriptionRow,
} from '@/shared/db/pg/effect/subscription-projector'
import { readUnderRls } from '@/shared/db/pg/rls-read'
import { getSessionUser } from '@/shared/firebase/admin'
import { listLinkedOrgIds } from '@/shared/identity/org-links'
import { listMemberOperationsForOrg } from '@/shared/org/member-operation-read'
import { getOrg } from '@/shared/org/org'
import { listStoredUnitsForOrg } from '@/shared/org/unit-read'
import { Schema } from 'effect'
import { redirect } from 'next/navigation'
import 'server-only'

const decodeAppointment = Schema.decodeUnknownSync(Appointment)
const decodeSubscription = Schema.decodeUnknownSync(Subscription)

export type MyAppointmentsPageData = {
  upcoming: AppointmentRowData[]
  past: AppointmentRowData[]
}

async function loadAppointmentsAcrossOrgs(userId: string): Promise<Appointment[]> {
  const orgIds = await listLinkedOrgIds(userId)
  const perOrg = await Promise.all(
    orgIds.map((tid) =>
      readUnderRls<AppointmentRow>(tid, (client) =>
        client
          .query<AppointmentRow>(
            'SELECT * FROM appointments WHERE org_id = $1 AND customer_user_id = $2',
            [tid, userId],
          )
          .then((res) => res.rows),
      ).then((rows) => rows.map((row) => decodeAppointment(appointmentRowToDoc(row)))),
    ),
  )
  return perOrg.flat().sort((a, b) => b.startAt.localeCompare(a.startAt))
}

// global User (no org membership required). Cross-org fetch via the identity
function buildAppointmentRow(
  a: Appointment,
  ctx: {
    orgSlug: string
    service: CatalogItem | undefined
    memberOperation: MemberOperation | undefined
    unit: StoredUnit | undefined
    closedOrder: Order | null
  },
): AppointmentRowData {
  const { unit } = ctx
  const livePolicy =
    unit?.agenda.mode === 'appointment' ? unit.agenda.cancellationPolicy : undefined
  const policy = a.cancellationPolicySnapshot
    ? normalizeCancellationPolicy(a.cancellationPolicySnapshot)
    : normalizeCancellationPolicy(livePolicy)
  const timeZone = unit?.timezone ?? DEFAULT_UNIT_TIMEZONE
  const startAtLabel = new Intl.DateTimeFormat('pt-BR', {
    timeZone,
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(a.startAt))
  const endAtLabel = new Intl.DateTimeFormat('pt-BR', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(a.endAt))
  const priceLabel = appointmentPriceLabel({
    servicePriceCentsSnapshot: a.servicePriceCentsSnapshot,
    closedOrder: ctx.closedOrder,
  })

  const check = canCustomerCancelAppointment(a, policy)
  const cancelReason = check.ok ? null : describeCancelReason(check, policy)

  const agenda = unit?.agenda
  const reschedule =
    agenda?.mode === 'appointment'
      ? {
          slotMinutes: agenda.slotMinutes,
          businessHours: agenda.businessHours,
          timezone: timeZone,
          durationMinutes: a.serviceDurationMinutesSnapshot,
        }
      : null

  return {
    orgId: a.orgId,
    orgSlug: ctx.orgSlug,
    unitSlug: unit?.slug ?? null,
    appointmentId: a.id,
    serviceName: ctx.service?.name ?? 'Serviço',
    memberOperationName: ctx.memberOperation?.name ?? '—',
    unitName: unit?.name ?? '—',
    startAtLabel,
    endAtLabel,
    priceLabel,
    status: a.status,
    canCancel: check.ok,
    cancelReason,
    cancellationPolicy: policy,
    reschedule,
  }
}

export async function loadMyAppointmentsPage(): Promise<MyAppointmentsPageData> {
  const session = await getSessionUser()
  if (!session) {
    redirect(`/login?next=${encodeURIComponent('/me/appointments')}`)
  }

  const appointments = await loadAppointmentsAcrossOrgs(session.uid)

  const orgIds = Array.from(new Set(appointments.map((a) => a.orgId)))
  const orgs = new Map<string, Org>()
  const services = new Map<string, CatalogItem>()
  const memberOperations = new Map<string, MemberOperation>()
  const units = new Map<string, StoredUnit>()
  const closedOrders = new Map<string, Order>()

  await Promise.all(
    orgIds.map(async (tid) => {
      const [org, catalogItems, enrichedPros, storedUnits, ordersByAppointment] = await Promise.all(
        [
          getOrg(tid),
          listCatalogItems(tid),
          listMemberOperationsForOrg(tid),
          listStoredUnitsForOrg(tid),
          loadClosedOrdersByAppointmentForOrg(tid),
        ],
      )
      if (org) orgs.set(tid, org)
      for (const item of catalogItems) services.set(`${tid}:${item.id}`, item)
      for (const p of enrichedPros) memberOperations.set(`${tid}:${p.id}`, p)
      for (const u of storedUnits) units.set(`${tid}:${u.id}`, u)
      for (const [appointmentId, order] of ordersByAppointment)
        closedOrders.set(`${tid}:${appointmentId}`, order)
    }),
  )

  const upcoming: AppointmentRowData[] = []
  const past: AppointmentRowData[] = []

  for (const a of appointments) {
    const org = orgs.get(a.orgId)
    if (!org) continue
    const row = buildAppointmentRow(a, {
      orgSlug: org.slug,
      service: services.get(`${a.orgId}:${a.serviceId}`),
      memberOperation: memberOperations.get(`${a.orgId}:${a.memberOperationId}`),
      unit: units.get(`${a.orgId}:${a.unitId}`),
      closedOrder: closedOrders.get(`${a.orgId}:${a.id}`) ?? null,
    })
    if (a.status === 'scheduled' && new Date(a.startAt).getTime() > Date.now()) {
      upcoming.push(row)
    } else {
      past.push(row)
    }
  }

  upcoming.reverse()

  return { upcoming, past }
}

export type MySubscriptionsPageData =
  | { empty: true }
  | { empty: false; rows: SubscriptionRowData[] }

async function loadSubscriptionsAcrossOrgs(userId: string): Promise<Subscription[]> {
  const orgIds = await listLinkedOrgIds(userId)
  const perOrg = await Promise.all(
    orgIds.map((tid) =>
      readUnderRls<SubscriptionRow>(tid, (client) =>
        client
          .query<SubscriptionRow>(
            'SELECT * FROM subscriptions WHERE org_id = $1 AND customer_user_id = $2',
            [tid, userId],
          )
          .then((res) => res.rows),
      ).then((rows) => rows.map((row) => decodeSubscription(subscriptionRowToDoc(row)))),
    ),
  )
  return perOrg.flat()
}

export async function loadMySubscriptionsPage(): Promise<MySubscriptionsPageData> {
  const session = await getSessionUser()
  if (!session) redirect('/login')

  const subscriptions = await loadSubscriptionsAcrossOrgs(session.uid)

  if (subscriptions.length === 0) return { empty: true }

  const orgIds = Array.from(new Set(subscriptions.map((s) => s.orgId)))
  const orgsById = new Map<string, Org>()
  await Promise.all(
    orgIds.map(async (tid) => {
      const org = await getOrg(tid)
      if (org) orgsById.set(tid, org)
    }),
  )

  const rows: SubscriptionRowData[] = subscriptions.map((subscription) => {
    const org = orgsById.get(subscription.orgId)
    const decision = canCustomerCancelSubscription(subscription, session.uid)
    return {
      subscription,
      orgName: org?.name ?? 'Estabelecimento',
      canCancel: decision.canCancel,
      cantCancelReason: decision.canCancel ? null : decision.reason,
    }
  })

  return { empty: false, rows }
}
