import {
  Appointment,
  CatalogItem,
  type Professional,
  StoredOrg,
  StoredProfessional,
  StoredUnit,
  Subscription,
  canCustomerCancelAppointment,
  canCustomerCancelSubscription,
  normalizeCancellationPolicy,
} from '@/domain'
import { describeCancelReason } from '@/features/me/core/cancel-notice'
import type { AppointmentRowData } from '@/features/me/ui/AppointmentRow'
import type { SubscriptionRowData } from '@/features/me/ui/SubscriptionRow'
import { getAdminFirestore } from '@/shared/db'
import { fsConverter } from '@/shared/db/converter'
import { getSessionUser } from '@/shared/firebase/admin'
import { enrichProfessionals } from '@/shared/org/professional-read'
import { redirect } from 'next/navigation'
import 'server-only'

export type MyAppointmentsPageData = {
  upcoming: AppointmentRowData[]
  past: AppointmentRowData[]
}

// #845 — Customer-facing list of their own appointments. Identity is the
// global User (no org membership required). Cross-org fetch via
// collectionGroup on `customerUserId` (the denormalized field added in
// #852 PR 4 exactly so CG queries don't need joins) — see #832 and the
// "Sem cross-org query" carve-out in CLAUDE.md for the customer-history
// surface.
export async function loadMyAppointmentsPage(): Promise<MyAppointmentsPageData> {
  const session = await getSessionUser()
  if (!session) {
    redirect(`/login?next=${encodeURIComponent('/me/appointments')}`)
  }

  const db = getAdminFirestore()
  const apptSnap = await db
    .collectionGroup('appointments')
    .where('customerUserId', '==', session.uid)
    .orderBy('startAt', 'desc')
    .withConverter(fsConverter(Appointment))
    .get()
  const appointments = apptSnap.docs.map((d) => d.data())

  // Hydrate display fields (service, professional, unit, org) in one
  // batched fetch per org — typical customer has appointments across
  // ≤ 2 orgs so the join cost is negligible.
  const orgIds = Array.from(new Set(appointments.map((a) => a.orgId)))
  const orgs = new Map<string, StoredOrg>()
  // Unified catalog (brief 0023, #1004): appointment.serviceId resolves against
  // catalog_items; only the name is rendered here.
  const services = new Map<string, CatalogItem>()
  const professionals = new Map<string, Professional>()
  const units = new Map<string, StoredUnit>()

  await Promise.all(
    orgIds.map(async (tid) => {
      const orgRef = db.collection('orgs').doc(tid)
      const [tSnap, sSnap, pSnap, uSnap] = await Promise.all([
        orgRef.withConverter(fsConverter(StoredOrg)).get(),
        orgRef.collection('catalog_items').withConverter(fsConverter(CatalogItem)).get(),
        orgRef.collection('professionals').withConverter(fsConverter(StoredProfessional)).get(),
        orgRef.collection('units').withConverter(fsConverter(StoredUnit)).get(),
      ])
      const org = tSnap.data()
      if (org) orgs.set(tid, org)
      for (const d of sSnap.docs) services.set(`${tid}:${d.id}`, d.data())
      // Professional PII (name) lives in the deletable `professionals_pii`
      // doc and is merged on read (#1036). Enrich per org before keying.
      const storedPros = pSnap.docs.map((d) => ({ ...d.data(), id: d.id }))
      const enrichedPros = await enrichProfessionals(tid, storedPros)
      for (const p of enrichedPros) professionals.set(`${tid}:${p.id}`, p)
      for (const d of uSnap.docs) units.set(`${tid}:${d.id}`, d.data())
    }),
  )

  const upcoming: AppointmentRowData[] = []
  const past: AppointmentRowData[] = []

  for (const a of appointments) {
    const org = orgs.get(a.orgId)
    if (!org) continue
    const service = services.get(`${a.orgId}:${a.serviceId}`)
    const professional = professionals.get(`${a.orgId}:${a.professionalId}`)
    const unit = units.get(`${a.orgId}:${a.unitId}`)
    // Snapshot-on-use (#1038): cada linha avalia o cancel contra a policy
    // congelada no commit do agendamento; fallback pra policy viva do org
    // em agendamentos legados (pré-migração) sem snapshot.
    const policy = a.cancellationPolicySnapshot
      ? normalizeCancellationPolicy(a.cancellationPolicySnapshot)
      : normalizeCancellationPolicy(org.cancellationPolicy)
    const fmt = new Intl.DateTimeFormat('pt-BR', {
      timeZone: org.timezone,
      weekday: 'short',
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    })
    const startAtLabel = fmt.format(new Date(a.startAt))
    const endFmt = new Intl.DateTimeFormat('pt-BR', {
      timeZone: org.timezone,
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
      professionalName: professional?.name ?? '—',
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

// #651 — Customer-facing list of their own subscriptions.
// Identity is the global User (no org membership required). Cross-org
// fetch via collectionGroup on `customerUserId` — same pattern as
// /me/appointments (#845, denormalized for CG queries per ADR 0004 carve-out).
export async function loadMySubscriptionsPage(): Promise<MySubscriptionsPageData> {
  const session = await getSessionUser()
  if (!session) redirect('/login')

  const db = getAdminFirestore()
  const subsSnap = await db
    .collectionGroup('subscriptions')
    .where('customerUserId', '==', session.uid)
    .withConverter(fsConverter(Subscription))
    .get()

  if (subsSnap.empty) return { empty: true }

  // Hidrata org info pra cada subscription
  const orgIds = Array.from(new Set(subsSnap.docs.map((d) => d.data().orgId)))
  const orgSnaps = await Promise.all(
    orgIds.map((tid) => db.collection('orgs').withConverter(fsConverter(StoredOrg)).doc(tid).get()),
  )
  const orgsById = new Map<string, StoredOrg>()
  for (const snap of orgSnaps) {
    const org = snap.data()
    if (org) orgsById.set(snap.id, org)
  }

  const rows: SubscriptionRowData[] = subsSnap.docs.map((doc) => {
    const subscription = doc.data()
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
