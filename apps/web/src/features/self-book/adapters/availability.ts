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

// Public availability payload for `/{orgSlug}/{unitSlug}/availability` (#842).
// Returns the slot grid for `date` plus the memberOperations (id+name only) so
// the UI can label rows without a second round-trip. PII never leaves the
// admin SDK boundary.
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
    // Temporal scope from the customer's active subscription (brief 0019,
    // Group B — AC-07). Null/undefined = unrestricted, matching the
    // avulso path. Caller resolves this via `resolveCustomerSubscriptionScope`.
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

  // Unified catalog read (brief 0023, #1004): availability is computed
  // directly on the `CatalogServiceItem` — the pure `computeAvailabilityForDay`
  // pipeline now consumes the unified shape (brief 0053, B3).
  if (!item) return null
  if (!isCatalogService(item)) return null
  if (!item.active || !item.publicVisible) return null
  if (!Array.isArray(item.unitIds) || !item.unitIds.includes(unit.id)) return null
  const service: CatalogServiceItem = item

  // Inverse query (brief 0068 D3): the operational memberOperations who perform this
  // service at this unit — served by the `member_operation_units`/`member_operation_services`
  // joins, replacing fetch-all + `memberOperationsForService` + operational filter in
  // JS. Identity (name) is merged from the global User; only `id`+`name` leave this
  // boundary below (PII never leaves it).
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

  // Day bounds in org tz, then read both appointments + blocks for the
  // unit on that day. Block query is unit-wide (no startAt filter) since
  // recurring blocks don't have one.
  // Timezone + slot grid are the establishment's (PRD Identidade v2 — moved
  // Org→Unit). The unit is bookable (appointment mode) by the guard above.
  const timezone = unit.timezone
  const { startUtc: dayStart, endUtc: dayEnd } = getOrgDayBoundsUtc(opts.date, timezone)
  // Appointments are read CROSS-UNIT per candidate professional (#1313): the
  // anti-double-book invariant is per-member_operation, so a slot a candidate
  // already fills in ANOTHER unit must not be offered here. Each appointment
  // belongs to exactly one member_operation, and `computeAvailabilityForDay`
  // filters per `pro.id`, so concatenating the per-candidate reads needs no dedup.
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

  // Temporal scope filter (brief 0019, Group B — AC-07). Apply per-slot
  // when the customer's resolved scope is non-null. `today` is captured
  // in the org tz so `advanceBookingDays` semantics match the
  // owner's expectation ("days ahead from today in our local calendar").
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
