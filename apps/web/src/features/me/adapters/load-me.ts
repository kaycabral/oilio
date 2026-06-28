import {
  Appointment,
  DEFAULT_UNIT_TIMEZONE,
  Subscription,
  canCustomerCancelAppointment,
  canCustomerCancelSubscription,
  normalizeCancellationPolicy,
  type CatalogItem,
  type MemberOperation,
  type Org,
  type StoredUnit,
} from '@/domain'
import { describeCancelReason } from '@/features/me/core/cancel-notice'
import type { AppointmentRowData } from '@/features/me/ui/AppointmentRow'
import type { SubscriptionRowData } from '@/features/me/ui/SubscriptionRow'
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

// Reads the subject's appointments across every org they are a customer of.
// Post-cutover (brief 0062) the banned cross-org `collectionGroup` is replaced
// by the identity-layer reverse index: `listLinkedOrgIds` (per-subject RLS on
// `org_links`) resolves the orgs the subject is a customer of, then each org's
// `appointments` are read under that org's RLS filtered by `customer_user_id`
// (the denormalized FK, #852). Same "≤ 2 orgs per customer" cost profile as the
// CG query — no banned cross-org scan.
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
  // Sort desc by startAt (ISO text → lexicographic = chronological), matching
  // the former `orderBy('startAt', 'desc')`.
  return perOrg.flat().sort((a, b) => b.startAt.localeCompare(a.startAt))
}

// #845 — Customer-facing list of their own appointments. Identity is the
// global User (no org membership required). Cross-org fetch via the identity
// reverse index (`org_links`) — see #832 and the "Sem cross-org query" carve-out
// in CLAUDE.md for the customer-history surface (now served by the per-subject
// link table, not a collectionGroup).
export async function loadMyAppointmentsPage(): Promise<MyAppointmentsPageData> {
  const session = await getSessionUser()
  if (!session) {
    redirect(`/login?next=${encodeURIComponent('/me/appointments')}`)
  }

  const appointments = await loadAppointmentsAcrossOrgs(session.uid)

  // Hydrate display fields (service, memberOperation, unit, org) in one
  // batched fetch per org — typical customer has appointments across
  // ≤ 2 orgs so the join cost is negligible.
  const orgIds = Array.from(new Set(appointments.map((a) => a.orgId)))
  const orgs = new Map<string, Org>()
  // Unified catalog (brief 0023, #1004): appointment.serviceId resolves against
  // catalog_items; only the name is rendered here.
  const services = new Map<string, CatalogItem>()
  const memberOperations = new Map<string, MemberOperation>()
  const units = new Map<string, StoredUnit>()

  await Promise.all(
    orgIds.map(async (tid) => {
      const [org, catalogItems, enrichedPros, storedUnits] = await Promise.all([
        getOrg(tid),
        listCatalogItems(tid),
        // MemberOperation PII (name) is merged from the global User on read (#1046).
        listMemberOperationsForOrg(tid),
        listStoredUnitsForOrg(tid),
      ])
      if (org) orgs.set(tid, org)
      for (const item of catalogItems) services.set(`${tid}:${item.id}`, item)
      for (const p of enrichedPros) memberOperations.set(`${tid}:${p.id}`, p)
      for (const u of storedUnits) units.set(`${tid}:${u.id}`, u)
    }),
  )

  const upcoming: AppointmentRowData[] = []
  const past: AppointmentRowData[] = []

  for (const a of appointments) {
    const org = orgs.get(a.orgId)
    if (!org) continue
    const service = services.get(`${a.orgId}:${a.serviceId}`)
    const memberOperation = memberOperations.get(`${a.orgId}:${a.memberOperationId}`)
    const unit = units.get(`${a.orgId}:${a.unitId}`)
    // Timezone + cancellation policy are the establishment's (PRD Identidade v2
    // — moved Org→Unit). Snapshot-on-use (#1038): cada linha avalia o cancel
    // contra a policy congelada no commit; fallback pra policy viva da agenda da
    // unidade (modo appointment) em agendamentos legados sem snapshot.
    const livePolicy =
      unit?.agenda.mode === 'appointment' ? unit.agenda.cancellationPolicy : undefined
    const policy = a.cancellationPolicySnapshot
      ? normalizeCancellationPolicy(a.cancellationPolicySnapshot)
      : normalizeCancellationPolicy(livePolicy)
    const timeZone = unit?.timezone ?? DEFAULT_UNIT_TIMEZONE
    const fmt = new Intl.DateTimeFormat('pt-BR', {
      timeZone,
      weekday: 'short',
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    })
    const startAtLabel = fmt.format(new Date(a.startAt))
    const endFmt = new Intl.DateTimeFormat('pt-BR', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
    })
    const endAtLabel = endFmt.format(new Date(a.endAt))
    const priceLabel = (a.servicePriceCentsSnapshot / 100).toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    })

    const check = canCustomerCancelAppointment(a, policy)
    const cancelReason = check.ok ? null : describeCancelReason(check, policy)

    const row: AppointmentRowData = {
      orgId: a.orgId,
      orgSlug: org.slug,
      unitSlug: unit?.slug ?? null,
      appointmentId: a.id,
      serviceName: service?.name ?? 'Serviço',
      memberOperationName: memberOperation?.name ?? '—',
      unitName: unit?.name ?? '—',
      startAtLabel,
      endAtLabel,
      priceLabel,
      status: a.status,
      canCancel: check.ok,
      cancelReason,
      cancellationPolicy: policy,
    }

    if (a.status === 'scheduled' && new Date(a.startAt).getTime() > Date.now()) {
      upcoming.push(row)
    } else {
      past.push(row)
    }
  }

  // CollectionGroup returns desc; upcoming should be asc (next-up first).
  upcoming.reverse()

  return { upcoming, past }
}

export type MySubscriptionsPageData =
  | { empty: true }
  | { empty: false; rows: SubscriptionRowData[] }

// Reads the subject's subscriptions across every org they are a customer of —
// same identity-reverse-index pattern as `loadAppointmentsAcrossOrgs` (brief
// 0062): `org_links` (per-subject RLS) resolves the orgs, then each org's typed
// `subscriptions` projection is read under that org's RLS filtered by
// `customer_user_id` (the denormalized FK).
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

// #651 — Customer-facing list of their own subscriptions.
// Identity is the global User (no org membership required). Cross-org
// fetch via the identity reverse index (`org_links`) — same pattern as
// /me/appointments (#845).
export async function loadMySubscriptionsPage(): Promise<MySubscriptionsPageData> {
  const session = await getSessionUser()
  if (!session) redirect('/login')

  const subscriptions = await loadSubscriptionsAcrossOrgs(session.uid)

  if (subscriptions.length === 0) return { empty: true }

  // Hidrata org info pra cada subscription (business name only).
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
