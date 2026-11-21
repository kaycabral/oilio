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
import { getSessionUser } from '@/shared/auth/session'
import { listCatalogItems } from '@/shared/db/effect/catalog-item-read'
import { resolveActiveUnit } from '@/shared/org/active-unit'
import { listAgendaBlocksForUnit } from '@/shared/org/agenda-block-read'
import {
  listMemberOperationAppointmentsInRange,
  listUnitAppointmentsInRange,
} from '@/shared/org/appointment-read'
import { listCustomersForOrg } from '@/shared/org/customer-read'
import {
  listBookableMemberOperationsForOrg,
  NO_MEMBER_OPERATION_SCOPE,
  resolveMemberOperationScope,
} from '@/shared/org/member-operation-read'
import { getActiveOrgContext } from '@/shared/org/membership'
import { getOrg } from '@/shared/org/org'
import { isSupabaseConfigured } from '@cbrl/supabase'
import { redirect } from 'next/navigation'
import 'server-only'

function isValidDateISO(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s)
}

type AgendaDayData = {
  appointments: Appointment[]
  busyByMemberOperation: Record<string, Appointment[]>
  blockSegments: ReturnType<typeof getBlockSegmentsForDay>
  allServices: CatalogServiceItem[]
  allCustomers: Customer[]
  servicesById: Map<string, CatalogServiceItem>
  customersById: Map<string, Customer>
}

const EMPTY_AGENDA_DAY_DATA: AgendaDayData = {
  appointments: [],
  busyByMemberOperation: {},
  blockSegments: [],
  allServices: [],
  allCustomers: [],
  servicesById: new Map(),
  customersById: new Map(),
}

type AgendaScope = {
  memberOperationScope: string
  selfMemberOperationId: string | null
  memberOperationMissing: boolean
  shouldLoadDay: boolean
}

async function resolveAgendaScope(
  membership: Membership,
  activeUnitId: string | null,
): Promise<AgendaScope> {
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

async function loadAgendaDayData(args: {
  orgId: string
  activeUnitId: string
  date: string
  timezone: string
  dayStart: string
  dayEnd: string
  memberOperationScope: string
  memberOperationIds: readonly string[]
  includeCancelled: boolean
}): Promise<AgendaDayData> {
  const { orgId, activeUnitId, date, timezone, dayStart, dayEnd, memberOperationScope } = args
  const [dayAppointments, busyPerMemberOperation, blocks, catalogItems, enrichedCustomers] =
    await Promise.all([
      listUnitAppointmentsInRange(
        orgId,
        activeUnitId,
        { startUtc: dayStart, endUtc: dayEnd },
        {
          memberOperationId: memberOperationScope,
          includeCancelled: args.includeCancelled,
        },
      ),
      Promise.all(
        args.memberOperationIds.map((id) =>
          listMemberOperationAppointmentsInRange(orgId, id, {
            startUtc: dayStart,
            endUtc: dayEnd,
          }).then((appointments) => [id, appointments] as const),
        ),
      ),
      listAgendaBlocksForUnit(orgId, activeUnitId, memberOperationScope),
      listCatalogItems(orgId),
      listCustomersForOrg(orgId),
    ])
  const blockSegments = getBlockSegmentsForDay(blocks, date, timezone)
  const allServices = catalogItems.filter(isCatalogService)
  const sortedCustomers = enrichedCustomers.sort((a, b) =>
    a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }),
  )
  const allCustomers = sortedCustomers.filter(
    (c) => c.archivedAt === null && c.deactivatedAt === null,
  )
  return {
    appointments: dayAppointments,
    busyByMemberOperation: Object.fromEntries(busyPerMemberOperation),
    blockSegments,
    allServices,
    allCustomers,
    servicesById: new Map(allServices.map((s) => [s.id, s])),
    customersById: new Map(sortedCustomers.map((c) => [c.id, c])),
  }
}

export async function loadAgendaPage(searchParams: {
  date?: string
  showCancelled?: string
}): Promise<AgendaViewProps> {
  if (!isSupabaseConfigured()) redirect('/')

  const session = await getSessionUser()
  if (!session) redirect('/login')

  const ctx = await getActiveOrgContext(session.uid)
  if (!ctx) redirect('/onboarding')

  const org = await getOrg(ctx.membership.orgId)
  if (!org) redirect('/onboarding')

  const [{ units, activeUnitId }, allMemberOperations] = await Promise.all([
    resolveActiveUnit(ctx.membership),
    listBookableMemberOperationsForOrg(ctx.membership.orgId),
  ])

  if (!units.some(unitUsesAgenda)) redirect('/orders')

  const activeUnit = activeUnitId ? (units.find((u) => u.id === activeUnitId) ?? null) : null

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

  const showCancelled = searchParams.showCancelled === '1'

  const scope = await resolveAgendaScope(ctx.membership, activeUnitId)
  const { selfMemberOperationId, memberOperationMissing, shouldLoadDay } = scope

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
          memberOperationIds: memberOperations.map((p) => p.id),
          includeCancelled: showCancelled,
        })
      : EMPTY_AGENDA_DAY_DATA

  const canManage = canManageOrg(ctx.membership.role)

  return {
    date,
    showCancelled,
    timezone,
    slotMinutes,
    units,
    activeUnitId,
    memberOperations,
    appointments: dayData.appointments,
    busyByMemberOperation: dayData.busyByMemberOperation,
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
    selfMemberOperationId,
    canManageCustomers: ctx.membership.permissions.canManageCustomers,
    memberOperationMissing,
  }
}
