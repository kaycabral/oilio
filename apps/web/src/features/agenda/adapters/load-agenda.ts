import {
  AgendaBlock,
  Appointment,
  CatalogItem,
  catalogServiceToService,
  type Customer,
  getBlockSegmentsForDay,
  getBusinessHoursForDay,
  getOrgDayBoundsUtc,
  getTodayInOrgTz,
  isBusinessHoursConfigured,
  isCatalogService,
  type Service,
  unitUsesAgenda,
} from '@/domain'
import type { AgendaViewProps } from '@/features/agenda/ui/AgendaView'
import { getAdminFirestore } from '@/shared/db'
import { fsConverter } from '@/shared/db/converter'
import { getSessionUser } from '@/shared/firebase/admin'
import { isFirebaseConfigured } from '@/shared/firebase/config'
import { resolveActiveUnit } from '@/shared/org/active-unit'
import { listCustomersForOrg } from '@/shared/org/customer-read'
import { getActiveOrgContext } from '@/shared/org/membership'
import { getOrg } from '@/shared/org/org'
import { listProfessionalsForOrg } from '@/shared/org/professional-read'
import { redirect } from 'next/navigation'
import 'server-only'

function isValidDateISO(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s)
}

// Imperative shell for the agenda route: resolves session/org/unit, loads the
// day's appointments + supporting catalog/customers, and returns the view-model
// `AgendaView` consumes. The route component stays a thin caller (page.tsx). All
// redirects (auth/org/capability gating) live here — they run during RSC
// render, so `redirect()` propagates from this helper just as it would inline.
export async function loadAgendaPage(searchParams: { date?: string }): Promise<AgendaViewProps> {
  if (!isFirebaseConfigured()) redirect('/')

  const session = await getSessionUser()
  if (!session) redirect('/login')

  const ctx = await getActiveOrgContext(session.uid)
  if (!ctx) redirect('/onboarding')

  const org = await getOrg(ctx.membership.orgId)
  if (!org) redirect('/onboarding')

  const date =
    searchParams.date && isValidDateISO(searchParams.date)
      ? searchParams.date
      : getTodayInOrgTz(org.timezone)

  const db = getAdminFirestore()
  const orgRef = db.collection('orgs').doc(ctx.membership.orgId)

  // Active unit comes from the shared context (brief 0029, AC-02): cookie →
  // validate → first accessible / pinned for single-unit members. The old
  // `?unitId=` isolated source is gone; switching happens via the switcher
  // (#1051) which writes the cookie.
  const [{ units, activeUnitId }, allProfessionals] = await Promise.all([
    resolveActiveUnit(ctx.membership),
    listProfessionalsForOrg(ctx.membership.orgId),
  ])

  // SPIKE (hours mode): the agenda is a capability gated on having ≥1 unit in
  // appointment mode. Hiding it from the nav isn't enough — enforce the route
  // too, so a direct URL doesn't reach a feature the establishment doesn't use.
  if (!units.some(unitUsesAgenda)) redirect('/orders')

  const activeUnit = activeUnitId ? (units.find((u) => u.id === activeUnitId) ?? null) : null

  const professionals = activeUnitId
    ? allProfessionals.filter((p) => p.unitIds.includes(activeUnitId))
    : []

  const dayHours = getBusinessHoursForDay(activeUnit?.businessHours ?? null, date, org.timezone)
  const hasBusinessHours = isBusinessHoursConfigured(activeUnit?.businessHours ?? null)

  const { startUtc: dayStart, endUtc: dayEnd } = getOrgDayBoundsUtc(date, org.timezone)

  let appointments: Appointment[] = []
  let customersById = new Map<string, Customer>()
  let servicesById = new Map<string, Service>()
  let blockSegments: ReturnType<typeof getBlockSegmentsForDay> = []
  let allServices: Service[] = []
  let allCustomers: Customer[] = []

  if (activeUnitId) {
    const [apptSnap, blocksSnap, servicesSnap, enrichedCustomers] = await Promise.all([
      orgRef
        .collection('appointments')
        .withConverter(fsConverter(Appointment))
        .where('unitId', '==', activeUnitId)
        .where('startAt', '>=', dayStart)
        .where('startAt', '<=', dayEnd)
        .orderBy('startAt')
        .get(),
      orgRef
        .collection('agenda_blocks')
        .withConverter(fsConverter(AgendaBlock))
        .where('unitId', '==', activeUnitId)
        .get(),
      orgRef
        .collection('catalog_items')
        .withConverter(fsConverter(CatalogItem))
        .orderBy('name')
        .get(),
      // Não é um `*Snap` — `listCustomersForOrg` já resolve o doc + faz
      // join com `users/` pro PII vir no shape público de `Customer`.
      listCustomersForOrg(ctx.membership.orgId),
    ])
    appointments = apptSnap.docs.map((d) => d.data())
    const blocks = blocksSnap.docs.map((d) => d.data())
    blockSegments = getBlockSegmentsForDay(blocks, date, org.timezone)
    // Unified catalog (brief 0023, #1004): the agenda picker offers kind-service
    // items, adapted to the legacy Service shape consumed by the dialog.
    allServices = servicesSnap.docs
      .map((d) => d.data())
      .filter(isCatalogService)
      .map(catalogServiceToService)
    const sortedCustomers = enrichedCustomers.sort((a, b) =>
      a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }),
    )
    // Picker (new appointment) offers ACTIVE customers only — a blocked/archived
    // customer drops out (#1100, AC-09). The display map keeps ALL customers so
    // existing appointments for a blocked customer still resolve to the neutral
    // label (history is retained de-identified).
    allCustomers = sortedCustomers.filter((c) => c.archivedAt === null)

    servicesById = new Map(allServices.map((s) => [s.id, s]))
    customersById = new Map(sortedCustomers.map((c) => [c.id, c]))
  }

  const canManage = ctx.membership.role === 'owner' || ctx.membership.role === 'manager'

  return {
    date,
    timezone: org.timezone,
    slotMinutes: org.slotMinutes,
    units,
    activeUnitId,
    professionals,
    appointments,
    customersById: Object.fromEntries(customersById),
    servicesById: Object.fromEntries(servicesById),
    dayHours,
    hasBusinessHours,
    blockSegments,
    services: allServices,
    customers: allCustomers,
    businessName: org.name,
    confirmationTemplate: org.whatsappTemplates.confirmation,
    canManage,
  }
}
