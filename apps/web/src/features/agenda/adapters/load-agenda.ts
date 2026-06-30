import {
  type Appointment,
  canManageOrg,
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
  type Membership,
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
import {
  listBookableMemberOperationsForOrg,
  NO_MEMBER_OPERATION_SCOPE,
  resolveMemberOperationScope,
} from '@/shared/org/member-operation-read'
import { getActiveOrgContext } from '@/shared/org/membership'
import { getOrg } from '@/shared/org/org'
import { redirect } from 'next/navigation'
import 'server-only'

function isValidDateISO(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s)
}

// The day-scoped slice of the agenda view-model: the RLS-scoped appointments +
// blocks for the active unit/day, plus the supporting catalog/customer maps.
// Extracted from `loadAgendaPage` so the page stays under the complexity gate.
type AgendaDayData = {
  appointments: Appointment[]
  blockSegments: ReturnType<typeof getBlockSegmentsForDay>
  allServices: CatalogServiceItem[]
  allCustomers: Customer[]
  servicesById: Map<string, CatalogServiceItem>
  customersById: Map<string, Customer>
}

// Empty slice for the no-unit / missing-profile paths (#1268) — keeps the
// view-model shape stable without running any read.
const EMPTY_AGENDA_DAY_DATA: AgendaDayData = {
  appointments: [],
  blockSegments: [],
  allServices: [],
  allCustomers: [],
  servicesById: new Map(),
  customersById: new Map(),
}

// The acting member's resolved agenda scope (brief 0075, #1256/#1257/#1268),
// derived once so the downstream consumers don't re-compute the gating predicate.
type AgendaScope = {
  // The raw scope passed to the RLS reads: `''` (balcão), a self id, or the
  // fail-closed sentinel.
  memberOperationScope: string
  // The self id to clamp columns / lock the dialog picker to; null for the balcão
  // AND for the degraded (sentinel) state.
  selfMemberOperationId: string | null
  // Degraded fail-closed state: a self-scoped member whose `member_operations`
  // projection isn't provisioned yet (sentinel scope).
  memberOperationMissing: boolean
  // Whether to run the day reads + render columns: needs an active unit AND a
  // non-degraded scope. When false the grid is empty by design.
  shouldLoadDay: boolean
}

// Resolves the acting member's scope and the single gating predicate the page
// branches on. Keeps `loadAgendaPage` flat (one call instead of three inline
// re-derivations of the same condition).
async function resolveAgendaScope(
  membership: Membership,
  activeUnitId: string | null,
): Promise<AgendaScope> {
  // `''` = balcão (owner/manager/recepção, permissive); a self id = own-scope;
  // the sentinel = fail-closed (projection not provisioned yet).
  const memberOperationScope = await resolveMemberOperationScope(membership)
  const memberOperationMissing = memberOperationScope === NO_MEMBER_OPERATION_SCOPE
  const selfMemberOperationId =
    memberOperationScope === '' || memberOperationMissing ? null : memberOperationScope
  return {
    memberOperationScope,
    selfMemberOperationId,
    memberOperationMissing,
    shouldLoadDay: activeUnitId !== null && !memberOperationMissing,
  }
}

// Loads the day's appointments + blocks (RLS-scoped to `memberOperationScope`) and
// the supporting catalog/customers for the active unit. All four reads are
// independent — run them together.
async function loadAgendaDayData(args: {
  orgId: string
  activeUnitId: string
  date: string
  timezone: string
  dayStart: string
  dayEnd: string
  memberOperationScope: string
  // Brief 0081 (#1311): forwarded from the `?showCancelled` toggle. Default false
  // hides `cancelled` from the read so freed slots render empty.
  includeCancelled: boolean
}): Promise<AgendaDayData> {
  const { orgId, activeUnitId, date, timezone, dayStart, dayEnd, memberOperationScope } = args
  const [dayAppointments, blocks, catalogItems, enrichedCustomers] = await Promise.all([
    // Unit-scoped read of the day's appointments from the typed `appointments`
    // table under RLS (brief 0061 § Grupo C / AC-04).
    listUnitAppointmentsInRange(
      orgId,
      activeUnitId,
      { startUtc: dayStart, endUtc: dayEnd },
      memberOperationScope,
      args.includeCancelled,
    ),
    // Backend-aware (brief 0060, Grupo C): Postgres reads the typed
    // `agenda_blocks` table under RLS, Firestore the org-scoped subcollection.
    listAgendaBlocksForUnit(orgId, activeUnitId, memberOperationScope),
    listCatalogItems(orgId),
    // Não é um `*Snap` — `listCustomersForOrg` já resolve o doc + faz join com
    // `users/` pro PII vir no shape público de `Customer`.
    listCustomersForOrg(orgId),
  ])
  const blockSegments = getBlockSegmentsForDay(blocks, date, timezone)
  // Unified catalog (brief 0023, #1004 → 0053/B3): the agenda picker offers the
  // kind-service catalog items directly — no adapter back to a legacy shape.
  const allServices = catalogItems.filter(isCatalogService)
  const sortedCustomers = enrichedCustomers.sort((a, b) =>
    a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }),
  )
  // Picker (new appointment) offers ACTIVE customers only — both non-active
  // states drop out: `archivedAt` (LGPD block, #1100 AC-09) AND `deactivatedAt`
  // (operator "Excluir cliente", brief 0033 AC-07). The display map below keeps
  // ALL customers so existing appointments for a removed/blocked customer still
  // resolve their name (history retained; blocked → neutral label).
  const allCustomers = sortedCustomers.filter(
    (c) => c.archivedAt === null && c.deactivatedAt === null,
  )
  return {
    appointments: dayAppointments,
    blockSegments,
    allServices,
    allCustomers,
    servicesById: new Map(allServices.map((s) => [s.id, s])),
    customersById: new Map(sortedCustomers.map((c) => [c.id, c])),
  }
}

// Imperative shell for the agenda route: resolves session/org/unit, loads the
// day's appointments + supporting catalog/customers, and returns the view-model
// `AgendaView` consumes. The route component stays a thin caller (page.tsx). All
// redirects (auth/org/capability gating) live here — they run during RSC
// render, so `redirect()` propagates from this helper just as it would inline.
export async function loadAgendaPage(searchParams: {
  date?: string
  showCancelled?: string
}): Promise<AgendaViewProps> {
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
  // `memberOperation` (read-path invariant). Excludes incomplete profiles, demoted
  // members whose projection lingers, and any non-memberOperation that wrongly
  // carries a projection row — none of them belong on the agenda grid.
  const [{ units, activeUnitId }, allMemberOperations] = await Promise.all([
    resolveActiveUnit(ctx.membership),
    listBookableMemberOperationsForOrg(ctx.membership.orgId),
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

  // Brief 0081 (#1311/#1312): the "mostrar cancelados" toggle is URL-driven
  // (`?showCancelled=1`), mirroring `?date=`. Off by default — the read hides
  // `cancelled`; flipping it on re-fetches the day with cancelled included.
  const showCancelled = searchParams.showCancelled === '1'

  // Own-scope (brief 0075, #1256/#1257/#1268): resolves the acting member's scope
  // once and derives every downstream flag from it (column clamp, dialog lock,
  // degraded empty-state, whether to run the day reads). Single source so the
  // gating predicate isn't re-derived per use.
  const scope = await resolveAgendaScope(ctx.membership, activeUnitId)
  const { selfMemberOperationId, memberOperationMissing, shouldLoadDay } = scope

  // A self-scoped memberOperation only sees their OWN column; the balcão keeps all
  // bookable columns. When the projection is missing (sentinel) there's no own
  // column to show — `shouldLoadDay` is false, so the grid is empty and the
  // explicit empty-state carries the message instead.
  const memberOperations =
    shouldLoadDay && activeUnitId !== null
      ? allMemberOperations.filter(
          (p) =>
            p.unitIds.includes(activeUnitId) &&
            (selfMemberOperationId === null || p.id === selfMemberOperationId),
        )
      : []

  const dayHours = getBusinessHoursForDay(activeUnitHours, date, timezone)
  const hasBusinessHours = isBusinessHoursConfigured(activeUnitHours)

  const { startUtc: dayStart, endUtc: dayEnd } = getOrgDayBoundsUtc(date, timezone)

  // Skip the day reads entirely when there's no active unit OR the member's
  // operational profile is missing (#1268): both yield an empty agenda, and the
  // sentinel reads would only come back empty anyway. The empty slice keeps the
  // view-model shape stable while the empty-state carries the reason.
  const dayData =
    shouldLoadDay && activeUnitId !== null
      ? await loadAgendaDayData({
          orgId: ctx.membership.orgId,
          activeUnitId,
          date,
          timezone,
          dayStart,
          dayEnd,
          memberOperationScope: scope.memberOperationScope,
          includeCancelled: showCancelled,
        })
      : EMPTY_AGENDA_DAY_DATA

  const canManage = canManageOrg(ctx.membership.role)

  return {
    date,
    // Brief 0081 (#1312): drives the toggle's pressed state + the grid's split
    // layout (cancelled cards only ever reach the UI when this is on).
    showCancelled,
    timezone,
    slotMinutes,
    units,
    activeUnitId,
    memberOperations,
    appointments: dayData.appointments,
    customersById: Object.fromEntries(dayData.customersById),
    servicesById: Object.fromEntries(dayData.servicesById),
    dayHours,
    hasBusinessHours,
    blockSegments: dayData.blockSegments,
    services: dayData.allServices,
    customers: dayData.allCustomers,
    businessName: org.name,
    confirmationTemplate,
    canManage,
    // #1257: when set, the appointment dialog locks the memberOperation picker to
    // this id (a self-scoped memberOperation books only for themselves). Null for
    // the balcão, which keeps the full picker.
    selfMemberOperationId,
    // #1255 AC-05: only the balcão may register a customer inline; a memberOperation
    // can't (the server action refuses too — this hides the toggle).
    canManageCustomers: ctx.membership.permissions.canManageCustomers,
    // #1268: a self-scoped member whose operational profile isn't provisioned yet
    // (onboarding incomplete / projection lag). The grid is intentionally empty
    // (fail-closed); the view renders an explicit actionable empty-state instead
    // of a mute blank grid that reads as data loss.
    memberOperationMissing,
  }
}
