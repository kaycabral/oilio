import {
  AgendaBlock,
  type AllowedTimeScope,
  Appointment,
  type AvailabilitySlot,
  CatalogItem,
  catalogServiceToService,
  computeAvailabilityForDay,
  getBlockSegmentsForDay,
  getTenantDayBoundsUtc,
  getTodayInTenantTz,
  isCatalogService,
  isInstantWithinTimeScope,
  isOperational,
  isReservedSlug,
  isReservedUnitSlug,
  isUnitBookable,
  isValidSlug,
  isValidUnitSlug,
  professionalsForService,
  type Service,
  StoredProfessional as StoredProfessionalSchema,
  StoredUnit,
  type Tenant,
} from '@/domain'
import { getAdminFirestore } from '@/shared/db'
import { fsConverter } from '@/shared/db/converter'
import { enrichProfessionals, type StoredProfessional } from '@/shared/tenant/professional-read'
import { getTenantBySlug } from '@/shared/tenant/tenant'
import 'server-only'

// Public availability payload for `/{tenantSlug}/{unitSlug}/availability` (#842).
// Returns the slot grid for `date` plus the professionals (id+name only) so
// the UI can label rows without a second round-trip. PII never leaves the
// admin SDK boundary.
export type PublicAvailability = {
  tenant: Tenant
  unit: StoredUnit
  service: Service
  date: string
  slots: AvailabilitySlot[]
  professionals: Array<{ id: string; name: string }>
}

export async function getPublicAvailability(
  slug: string,
  unitSlug: string,
  opts: {
    serviceId: string
    date: string
    professionalId?: string | null
    // Temporal scope from the customer's active subscription (brief 0019,
    // Group B — AC-07). Null/undefined = unrestricted, matching the
    // avulso path. Caller resolves this via `resolveCustomerSubscriptionScope`.
    timeScope?: AllowedTimeScope | null
  },
): Promise<PublicAvailability | null> {
  if (!isValidSlug(slug) || isReservedSlug(slug)) return null
  if (!isValidUnitSlug(unitSlug) || isReservedUnitSlug(unitSlug)) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(opts.date)) return null

  const tenant = await getTenantBySlug(slug)
  if (!tenant) return null

  const db = getAdminFirestore()
  const tenantRef = db.collection('tenants').doc(tenant.id)
  const [unitsSnap, servicesSnap, professionalsSnap] = await Promise.all([
    tenantRef.collection('units').withConverter(fsConverter(StoredUnit)).get(),
    tenantRef
      .collection('catalog_items')
      .doc(opts.serviceId)
      .withConverter(fsConverter(CatalogItem))
      .get(),
    tenantRef
      .collection('professionals')
      .withConverter(fsConverter(StoredProfessionalSchema))
      .get(),
  ])

  const unit = unitsSnap.docs.map((d) => d.data()).find((u) => u.slug === unitSlug)
  if (!unit) return null
  if (!isUnitBookable(unit)) return null

  // Unified catalog read (brief 0023, #1004): availability is computed for a
  // kind service item, adapted to the legacy Service shape so the pure
  // `computeAvailabilityForDay` pipeline stays unchanged.
  const item = servicesSnap.data()
  if (!item) return null
  if (!isCatalogService(item)) return null
  if (!item.active || !item.publicVisible) return null
  if (!Array.isArray(item.unitIds) || !item.unitIds.includes(unit.id)) return null
  const service: Service = catalogServiceToService(item)

  // PII (name) lives in `professionals_pii` and is merged on read (#1036).
  const storedPros: StoredProfessional[] = professionalsSnap.docs.map((d) => ({
    ...d.data(),
    id: d.id,
  }))
  const allProfessionals = await enrichProfessionals(tenant.id, storedPros)
  let candidates = professionalsForService(allProfessionals, service.id, unit.id).filter((p) =>
    isOperational(p.operationalStatus),
  )
  if (opts.professionalId) {
    candidates = candidates.filter((p) => p.id === opts.professionalId)
  }

  if (candidates.length === 0) {
    return {
      tenant,
      unit,
      service,
      date: opts.date,
      slots: [],
      professionals: [],
    }
  }

  // Day bounds in tenant tz, then read both appointments + blocks for the
  // unit on that day. Block query is unit-wide (no startAt filter) since
  // recurring blocks don't have one.
  const { startUtc: dayStart, endUtc: dayEnd } = getTenantDayBoundsUtc(opts.date, tenant.timezone)
  const [apptSnap, blocksSnap] = await Promise.all([
    tenantRef
      .collection('appointments')
      .withConverter(fsConverter(Appointment))
      .where('unitId', '==', unit.id)
      .where('startAt', '>=', dayStart)
      .where('startAt', '<=', dayEnd)
      .get(),
    tenantRef
      .collection('agenda_blocks')
      .withConverter(fsConverter(AgendaBlock))
      .where('unitId', '==', unit.id)
      .get(),
  ])
  const appointments = apptSnap.docs.map((d) => d.data())
  const blocks = blocksSnap.docs.map((d) => d.data())
  const blockSegments = getBlockSegmentsForDay(blocks, opts.date, tenant.timezone)

  const rawSlots = computeAvailabilityForDay({
    service,
    unitId: unit.id,
    professionals: candidates,
    unitBusinessHours: unit.businessHours,
    appointments,
    blockSegments,
    date: opts.date,
    slotMinutes: tenant.slotMinutes,
    timezone: tenant.timezone,
  })

  // Temporal scope filter (brief 0019, Group B — AC-07). Apply per-slot
  // when the customer's resolved scope is non-null. `today` is captured
  // in the tenant tz so `advanceBookingDays` semantics match the
  // owner's expectation ("days ahead from today in our local calendar").
  const slots =
    opts.timeScope == null
      ? rawSlots
      : (() => {
          const today = getTodayInTenantTz(tenant.timezone)
          return rawSlots.filter((s) =>
            isInstantWithinTimeScope(opts.timeScope, s.startAt, tenant.timezone, today),
          )
        })()

  return {
    tenant,
    unit,
    service,
    date: opts.date,
    slots,
    professionals: candidates.map((p) => ({ id: p.id, name: p.name })),
  }
}
