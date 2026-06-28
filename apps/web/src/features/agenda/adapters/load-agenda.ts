import {
  type Appointment,
  type CatalogServiceItem,
  type Customer,
  DEFAULT_SLOT_MINUTES,
  DEFAULT_UNIT_TIMEZONE,
  getBlockSegmentsForDay,
  getBusinessHoursForDay,
  getOrgDayBoundsUtc,
  getTodayInOrgTz,
  isBusinessHoursConfigured,
  isCatalogService,
  resolveWhatsappTemplates,
  unitBusinessHours,
  unitSlotMinutes,
  unitUsesAgenda,
} from '@/domain'
import type { AgendaViewProps } from '@/features/agenda/ui/AgendaView'
import { listCatalogItems } from '@/shared/db/effect/catalog-item-read'
import { getSessionUser } from '@/shared/firebase/admin'
import { isFirebaseConfigured } from '@/shared/firebase/config'
import { resolveActiveUnit } from '@/shared/org/active-unit'
import { listAgendaBlocksForUnit } from '@/shared/org/agenda-block-read'
import { listUnitAppointmentsInRange } from '@/shared/org/appointment-read'
import { listCustomersForOrg } from '@/shared/org/customer-read'
import { getActiveOrgContext } from '@/shared/org/membership'
import { getOrg } from '@/shared/org/org'
import { listBookableProfessionalsForOrg } from '@/shared/org/professional-read'
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

  // Active unit comes from the shared context (brief 0029, AC-02): cookie →
  // validate → first accessible / pinned for single-unit members. The old
  // `?unitId=` isolated source is gone; switching happens via the switcher
  // (#1051) which writes the cookie.
  // Bookable = operational AND backed by an active membership with role
  // `professional` (read-path invariant). Excludes incomplete profiles, demoted
  // members whose projection lingers, and any non-professional that wrongly
  // carries a projection row — none of them belong on the agenda grid.
  const [{ units, activeUnitId }, allProfessionals] = await Promise.all([
    resolveActiveUnit(ctx.membership),
    listBookableProfessionalsForOrg(ctx.membership.orgId),
  ])

  // SPIKE (hours mode): the agenda is a capability gated on having ≥1 unit in
  // appointment mode. Hiding it from the nav isn't enough — enforce the route
  // too, so a direct URL doesn't reach a feature the establishment doesn't use.
  if (!units.some(unitUsesAgenda)) redirect('/orders')

  const activeUnit = activeUnitId ? (units.find((u) => u.id === activeUnitId) ?? null) : null

  // Timezone + slot grid are establishment/agenda concerns (PRD Identidade v2 —
  // moved Org→Unit): source them from the active unit's agenda; fall back to the
  // default tz / slot when no unit is active yet.
  const timezone = activeUnit?.timezone ?? DEFAULT_UNIT_TIMEZONE
  const slotMinutes = activeUnit ? unitSlotMinutes(activeUnit.agenda) : DEFAULT_SLOT_MINUTES
  const confirmationTemplate = resolveWhatsappTemplates(
    activeUnit?.agenda.mode === 'appointment' ? activeUnit.agenda.confirmationTemplates : null,
  ).confirmation
  const activeUnitHours = activeUnit ? unitBusinessHours(activeUnit.agenda) : null

  const date =
    searchParams.date && isValidDateISO(searchParams.date)
      ? searchParams.date
      : getTodayInOrgTz(timezone)

  const professionals = activeUnitId
    ? allProfessionals.filter((p) => p.unitIds.includes(activeUnitId))
    : []

  const dayHours = getBusinessHoursForDay(activeUnitHours, date, timezone)
  const hasBusinessHours = isBusinessHoursConfigured(activeUnitHours)

  const { startUtc: dayStart, endUtc: dayEnd } = getOrgDayBoundsUtc(date, timezone)

  let appointments: Appointment[] = []
  let customersById = new Map<string, Customer>()
  let servicesById = new Map<string, CatalogServiceItem>()
  let blockSegments: ReturnType<typeof getBlockSegmentsForDay> = []
  let allServices: CatalogServiceItem[] = []
  let allCustomers: Customer[] = []

  if (activeUnitId) {
    const [dayAppointments, blocks, catalogItems, enrichedCustomers] = await Promise.all([
      // Unit-scoped read of the day's appointments from the typed `appointments`
      // table under RLS (brief 0061 § Grupo C / AC-04).
      listUnitAppointmentsInRange(ctx.membership.orgId, activeUnitId, dayStart, dayEnd),
      // Backend-aware (brief 0060, Grupo C): Postgres reads the typed
      // `agenda_blocks` table under RLS, Firestore the org-scoped subcollection.
      listAgendaBlocksForUnit(ctx.membership.orgId, activeUnitId),
      listCatalogItems(ctx.membership.orgId),
      // Não é um `*Snap` — `listCustomersForOrg` já resolve o doc + faz
      // join com `users/` pro PII vir no shape público de `Customer`.
      listCustomersForOrg(ctx.membership.orgId),
    ])
    appointments = dayAppointments
    blockSegments = getBlockSegmentsForDay(blocks, date, timezone)
    // Unified catalog (brief 0023, #1004 → 0053/B3): the agenda picker offers
    // the kind-service catalog items directly — no adapter back to a legacy shape.
    allServices = catalogItems.filter(isCatalogService)
    const sortedCustomers = enrichedCustomers.sort((a, b) =>
      a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }),
    )
    // Picker (new appointment) offers ACTIVE customers only — both non-active
    // states drop out: `archivedAt` (LGPD block, #1100 AC-09) AND `deactivatedAt`
    // (operator "Excluir cliente", brief 0033 AC-07). The display map below keeps
    // ALL customers so existing appointments for a removed/blocked customer still
    // resolve their name (history retained; blocked → neutral label).
    allCustomers = sortedCustomers.filter((c) => c.archivedAt === null && c.deactivatedAt === null)

    servicesById = new Map(allServices.map((s) => [s.id, s]))
    customersById = new Map(sortedCustomers.map((c) => [c.id, c]))
  }

  const canManage = ctx.membership.role === 'owner' || ctx.membership.role === 'manager'

  return {
    date,
    timezone,
    slotMinutes,
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
    confirmationTemplate,
    canManage,
  }
}
