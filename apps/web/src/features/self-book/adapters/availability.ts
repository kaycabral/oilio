import {
  type AllowedTimeScope,
  type AvailabilitySlot,
  type CatalogServiceItem,
  computeAvailabilityForDay,
  getBlockSegmentsForDay,
  getOrgDayBoundsUtc,
  getTodayInOrgTz,
  isCatalogService,
  isInstantWithinTimeScope,
  isReservedSlug,
  isReservedUnitSlug,
  isUnitBookable,
  isValidSlug,
  isValidUnitSlug,
  type Org,
  type StoredUnit,
  unitBusinessHours,
  unitSlotMinutes,
} from '@/domain'
import { getCatalogItemById } from '@/shared/db/effect/catalog-item-read'
import { listAgendaBlocksForUnit } from '@/shared/org/agenda-block-read'
import { listMemberOperationAppointmentsInRange } from '@/shared/org/appointment-read'
import { listMemberOperationsForServiceInUnit } from '@/shared/org/member-operation-read'
import { getOrgBySlug } from '@/shared/org/org'
import { listStoredUnitsForOrg } from '@/shared/org/unit-read'
import 'server-only'

export type PublicAvailability = {
  org: Org
  unit: StoredUnit
  service: CatalogServiceItem
  date: string
  slots: AvailabilitySlot[]
  memberOperations: Array<{ id: string; name: string }>
}

export async function getPublicAvailability(
  slug: string,
  unitSlug: string,
  opts: {
    serviceId: string
    date: string
    memberOperationId?: string | null
    timeScope?: AllowedTimeScope | null
  },
): Promise<PublicAvailability | null> {
  if (!isValidSlug(slug) || isReservedSlug(slug)) return null
  if (!isValidUnitSlug(unitSlug) || isReservedUnitSlug(unitSlug)) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(opts.date)) return null

  const org = await getOrgBySlug(slug)
  if (!org) return null

  const [units, item] = await Promise.all([
    listStoredUnitsForOrg(org.id),
    getCatalogItemById(org.id, opts.serviceId),
  ])

  const unit = units.find((u) => u.slug === unitSlug)
  if (!unit) return null
  if (!isUnitBookable(unit)) return null

  if (!item) return null
  if (!isCatalogService(item)) return null
  if (!item.active || !item.publicVisible) return null
  if (!Array.isArray(item.unitIds) || !item.unitIds.includes(unit.id)) return null
  const service: CatalogServiceItem = item

  let candidates = await listMemberOperationsForServiceInUnit(org.id, service.id, unit.id)
  if (opts.memberOperationId) {
    candidates = candidates.filter((p) => p.id === opts.memberOperationId)
  }

  if (candidates.length === 0) {
    return {
      org,
      unit,
      service,
      date: opts.date,
      slots: [],
      memberOperations: [],
    }
  }

  const timezone = unit.timezone
  const { startUtc: dayStart, endUtc: dayEnd } = getOrgDayBoundsUtc(opts.date, timezone)
  const [appointmentsPerCandidate, blocks] = await Promise.all([
    Promise.all(
      candidates.map((c) =>
        listMemberOperationAppointmentsInRange(org.id, c.id, {
          startUtc: dayStart,
          endUtc: dayEnd,
        }),
      ),
    ),
    listAgendaBlocksForUnit(org.id, unit.id),
  ])
  const appointments = appointmentsPerCandidate.flat()
  const blockSegments = getBlockSegmentsForDay(blocks, opts.date, timezone)

  const rawSlots = computeAvailabilityForDay({
    service,
    unitId: unit.id,
    memberOperations: candidates,
    unitBusinessHours: unitBusinessHours(unit.agenda),
    appointments,
    blockSegments,
    date: opts.date,
    slotMinutes: unitSlotMinutes(unit.agenda),
    timezone,
  })

  const slots =
    opts.timeScope == null
      ? rawSlots
      : (() => {
          const today = getTodayInOrgTz(timezone)
          return rawSlots.filter((s) =>
            isInstantWithinTimeScope(opts.timeScope, s.startAt, timezone, today),
          )
        })()

  return {
    org,
    unit,
    service,
    date: opts.date,
    slots,
    memberOperations: candidates.map((p) => ({ id: p.id, name: p.name })),
  }
}
