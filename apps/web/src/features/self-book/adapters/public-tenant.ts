import {
  CatalogItem,
  type CatalogServiceItem,
  catalogServiceToService,
  isCatalogProduct,
  isCatalogService,
  isOperational,
  isReservedSlug,
  isReservedUnitSlug,
  isUnitBookable,
  isValidSlug,
  isValidUnitSlug,
  type Professional,
  type PublicCatalogItem,
  type PublicService,
  type Service,
  StoredProfessional as StoredProfessionalSchema,
  type Tenant,
  toPublicCatalogItem,
  toPublicService,
  type Unit,
} from '@/domain'
import { getAdminFirestore } from '@/shared/db'
import { fsConverter } from '@/shared/db/converter'
import { enrichProfessionals, type StoredProfessional } from '@/shared/tenant/professional-read'
import { getTenantBySlug } from '@/shared/tenant/tenant'
import { listUnitsForTenant } from '@/shared/tenant/unit-read'
import 'server-only'

// Legacy tenant-wide bundle. Still used by `/{tenantSlug}/book` (single-
// unit booking — the wizard in #844 will replace it). Returns the raw
// Service[] (sin sanitization) since the consumer is server-only. Sourced from
// the unified catalog (brief 0023, #1004) adapted to the legacy Service shape.
export type PublicTenantBundle = {
  tenant: Tenant
  services: Service[]
}

// Tenant landing payload (#841). Used by `/{tenantSlug}` to decide
// single-unit (catalog inline) vs multi-unit (picker). `units` is the
// full list of unit docs — the page renders names/addresses for the
// picker; sanitization isn't required since unit docs carry no
// commission/PII.
export type PublicTenantSummary = {
  tenant: Tenant
  units: Unit[]
}

// Unit-scoped catalog payload (#841). `services` is already sanitized
// via `toPublicService` — drops commission/unitOverrides/active/publicVisible
// and resolves priceCents/durationMinutes per the unit override stack.
// When the optional `professionalId` filter is applied, `services` is
// further narrowed to entries the pro executes (#876).
export type PublicUnitBundle = {
  tenant: Tenant
  unit: Unit
  units: Unit[]
  services: PublicService[]
  // Unified public catalog projection (brief 0023, AC-08 — #1004). Projects
  // BOTH kinds for this unit: every kind-service item (same set as `services`)
  // plus products with `publicVisible`. The UI convergence onto this lives in
  // #1005; for now it ships ready so the landing can render products.
  catalogItems: PublicCatalogItem[]
  professional: Professional | null
}

async function loadTenantUnits(tenantId: string): Promise<Unit[]> {
  // PII (whatsapp/email) lives in `units_pii` and is merged on read (#1036).
  return listUnitsForTenant(tenantId)
}

// Active + public kind-service items, adapted to the legacy Service shape so
// the existing public surfaces (booking forms, availability) stay unchanged.
async function loadPublicServices(tenantId: string): Promise<Service[]> {
  return (await loadPublicCatalogServiceItems(tenantId)).map(catalogServiceToService)
}

// Raw active + public kind-service catalog items (brief 0023, #1004).
async function loadPublicCatalogServiceItems(tenantId: string): Promise<CatalogServiceItem[]> {
  const snap = await getAdminFirestore()
    .collection('tenants')
    .doc(tenantId)
    .collection('catalog_items')
    .withConverter(fsConverter(CatalogItem))
    .orderBy('name')
    .get()
  return snap.docs
    .map((d) => d.data())
    .filter(isCatalogService)
    .filter((s) => s.active && s.publicVisible)
}

// Both kinds for the public catalog (AC-08): public services + public products.
async function loadPublicCatalogItems(tenantId: string): Promise<CatalogItem[]> {
  const snap = await getAdminFirestore()
    .collection('tenants')
    .doc(tenantId)
    .collection('catalog_items')
    .withConverter(fsConverter(CatalogItem))
    .orderBy('name')
    .get()
  return snap.docs.map((d) => d.data()).filter((i) => i.active && i.publicVisible)
}

// Legacy bundle. Toda leitura passa pelo admin SDK (server-only) — Firestore
// Rules continuam bloqueando read pra não-members; expomos só o slice que
// o público deve ver (Tenant base + serviços com publicVisible=true && active).
export async function getPublicTenantBundle(slug: string): Promise<PublicTenantBundle | null> {
  if (!isValidSlug(slug) || isReservedSlug(slug)) return null

  const tenant = await getTenantBySlug(slug)
  if (!tenant) return null
  if (!tenant.selfBookingPublished) return null

  const services = await loadPublicServices(tenant.id)
  return { tenant, services }
}

// Resolve the public landing payload for `/{tenantSlug}` (#841). Returns
// null when slug is malformed/reserved, tenant doesn't exist, or the
// owner hasn't published the self-booking page yet (#988 gate).
export async function getPublicTenantSummary(slug: string): Promise<PublicTenantSummary | null> {
  if (!isValidSlug(slug) || isReservedSlug(slug)) return null

  const tenant = await getTenantBySlug(slug)
  if (!tenant) return null

  // SPIKE (inferred availability): the tenant is "live" iff ≥1 unit is bookable
  // (appointment mode + hours). The landing lists only bookable units; none →
  // 404 (the derived tenant-level "is anything live", computed not stored).
  const units = (await loadTenantUnits(tenant.id)).filter((u) => isUnitBookable(u))
  if (units.length === 0) return null
  return { tenant, units }
}

// Resolve the unit-scoped catalog for `/{tenantSlug}/{unitSlug}` (#841).
// Returns null on malformed/reserved slug, missing tenant/unit, or
// unpublished self-booking (#988 gate).
//
// `professionalId` further filters the catalog to services the pro
// executes — used by `/{tenantSlug}/{unitSlug}?professional={id}`. An
// unknown/unauthorized id returns an empty catalog (not null) so the user
// can clear the filter without hitting a 404, and `professional` stays
// null so the UI doesn't pretend the filter is active.
export async function getPublicUnitBundle(
  slug: string,
  unitSlug: string,
  opts: { professionalId?: string | null } = {},
): Promise<PublicUnitBundle | null> {
  if (!isValidSlug(slug) || isReservedSlug(slug)) return null
  if (!isValidUnitSlug(unitSlug) || isReservedUnitSlug(unitSlug)) return null

  const tenant = await getTenantBySlug(slug)
  if (!tenant) return null

  const db = getAdminFirestore()
  const tenantRef = db.collection('tenants').doc(tenant.id)
  const [units, services, allPublicItems, prosSnap] = await Promise.all([
    loadTenantUnits(tenant.id),
    loadPublicServices(tenant.id),
    loadPublicCatalogItems(tenant.id),
    tenantRef
      .collection('professionals')
      .withConverter(fsConverter(StoredProfessionalSchema))
      .get(),
  ])

  const unit = units.find((u) => u.slug === unitSlug)
  if (!unit) return null
  // SPIKE (inferred availability): a non-bookable unit's page is offline even
  // if siblings are live.
  if (!isUnitBookable(unit)) return null

  let unitServices = services.filter((s) => Array.isArray(s.unitIds) && s.unitIds.includes(unit.id))
  // Both kinds offered in this unit (AC-08): services + products with
  // publicVisible. Service filtering mirrors `unitServices` (pro filter applies
  // below); products are listed unit-wide for the unit's catalog.
  let unitItems = allPublicItems.filter(
    (i) => Array.isArray(i.unitIds) && i.unitIds.includes(unit.id),
  )

  let professional: Professional | null = null
  if (opts.professionalId) {
    const storedPro: StoredProfessional | null =
      prosSnap.docs
        .map((d) => ({ ...d.data(), id: d.id }))
        .find((p) => p.id === opts.professionalId) ?? null
    if (
      storedPro &&
      storedPro.unitIds.includes(unit.id) &&
      isOperational(storedPro.operationalStatus)
    ) {
      // PII (name) merged from `professionals_pii` on read (#1036).
      const [enriched] = await enrichProfessionals(tenant.id, [storedPro])
      professional = enriched ?? null
      const proServiceIds = new Set(storedPro.serviceIds ?? [])
      unitServices = unitServices.filter((s) => proServiceIds.has(s.id))
      // When filtering by professional, narrow services to ones the pro
      // executes; products stay visible (they aren't pro-scoped).
      unitItems = unitItems.filter((i) => isCatalogProduct(i) || proServiceIds.has(i.id))
    } else {
      unitServices = []
      unitItems = unitItems.filter(isCatalogProduct)
    }
  }

  const publicServices = unitServices.map((s) => toPublicService(s, unit.id))
  const catalogItems = unitItems.map((i) => toPublicCatalogItem(i, unit.id))
  return { tenant, unit, units, services: publicServices, catalogItems, professional }
}
