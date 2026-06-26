import {
  type CatalogServiceItem,
  isCatalogService,
  isOperational,
  isReservedSlug,
  isReservedUnitSlug,
  isValidSlug,
  isValidUnitSlug,
  type Org,
  type Professional,
  type PublicCatalogItem,
  toPublicCatalogItem,
  type Unit,
} from '@/domain'
import { isUnitPubliclyLive } from '@/features/units/core/publish-readiness'
import { listCatalogItems } from '@/shared/db/effect/catalog-item-read'
import { getOrgBySlug } from '@/shared/org/org'
import { listProfessionalsForOrg } from '@/shared/org/professional-read'
import { listUnitsForOrg } from '@/shared/org/unit-read'
import 'server-only'

// Legacy org-wide bundle. Still used by `/{orgSlug}/book` (single-
// unit booking — the wizard in #844 will replace it). Returns the raw
// `CatalogServiceItem[]` (no sanitization) since the consumer is server-only.
// Sourced directly from the unified catalog (brief 0023, #1004 → 0053/B3).
export type PublicOrgBundle = {
  org: Org
  catalogServiceItems: CatalogServiceItem[]
}

// Org landing payload (#841). Used by `/{orgSlug}` to decide
// single-unit (catalog inline) vs multi-unit (picker). `units` is the
// full list of unit docs — the page renders names/addresses for the
// picker; sanitization isn't required since unit docs carry no
// commission/PII.
export type PublicOrgSummary = {
  org: Org
  units: Unit[]
}

// Unit-scoped catalog payload (#841). `catalogServiceItems` is the public
// projection of the unit's kind-service items via `toPublicCatalogItem` —
// drops commission/unitOverrides/active/publicVisible and resolves
// priceCents/durationMinutes per the unit override stack. When the optional
// `professionalId` filter is applied, it is further narrowed to entries the
// pro executes (#876). Brief 0053/B3 converges this onto `PublicCatalogItem`
// (the unified projection, AC-08 — #1004), closing the UI convergence (#1005).
export type PublicUnitBundle = {
  org: Org
  unit: Unit
  units: Unit[]
  catalogServiceItems: PublicCatalogItem[]
  professional: Professional | null
}

async function loadOrgUnits(orgId: string): Promise<Unit[]> {
  // PII (whatsapp/email) lives in `units_pii` and is merged on read (#1036).
  return listUnitsForOrg(orgId)
}

// Raw active + public kind-service catalog items (brief 0023, #1004).
async function loadPublicCatalogServiceItems(orgId: string): Promise<CatalogServiceItem[]> {
  const items = await listCatalogItems(orgId)
  return items.filter(isCatalogService).filter((s) => s.active && s.publicVisible)
}

// Legacy bundle. Toda leitura passa pelo admin SDK (server-only) — Firestore
// Rules continuam bloqueando read pra não-members; expomos só o slice que
// o público deve ver (Org base + serviços com publicVisible=true && active).
export async function getPublicOrgBundle(slug: string): Promise<PublicOrgBundle | null> {
  if (!isValidSlug(slug) || isReservedSlug(slug)) return null

  const org = await getOrgBySlug(slug)
  if (!org) return null
  // Self-booking is per-unit now (PRD Identidade v2 — moved Org→Unit) and
  // inferred (no stored publish flag): the org-wide legacy bundle is live iff
  // ≥1 unit is publicly live (appointment agenda + configured hours).
  const units = await loadOrgUnits(org.id)
  if (!units.some(isUnitPubliclyLive)) return null

  const catalogServiceItems = await loadPublicCatalogServiceItems(org.id)
  return { org, catalogServiceItems }
}

// Resolve the public landing payload for `/{orgSlug}` (#841). Returns
// null when slug is malformed/reserved, org doesn't exist, or the
// owner hasn't published the self-booking page yet (#988 gate).
export async function getPublicOrgSummary(slug: string): Promise<PublicOrgSummary | null> {
  if (!isValidSlug(slug) || isReservedSlug(slug)) return null

  const org = await getOrgBySlug(slug)
  if (!org) return null

  // The landing lists only publicly-live units (PRD Identidade v2 — self-booking
  // is a per-unit, inferred appointment-agenda concern: appointment mode +
  // configured hours, no stored flag). None live → 404 (the derived org-level
  // "is anything live", computed not stored).
  const units = (await loadOrgUnits(org.id)).filter(isUnitPubliclyLive)
  if (units.length === 0) return null
  return { org, units }
}

// Resolve the unit-scoped catalog for `/{orgSlug}/{unitSlug}` (#841).
// Returns null on malformed/reserved slug, missing org/unit, or
// unpublished self-booking (#988 gate).
//
// `professionalId` further filters the catalog to services the pro
// executes — used by `/{orgSlug}/{unitSlug}?professional={id}`. An
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

  const org = await getOrgBySlug(slug)
  if (!org) return null

  const [units, serviceItems, professionals] = await Promise.all([
    loadOrgUnits(org.id),
    loadPublicCatalogServiceItems(org.id),
    // Backend-aware read (Postgres typed table under RLS / Firestore); enriched
    // with PII (name from `professionals_pii`/User), so no separate merge below.
    listProfessionalsForOrg(org.id),
  ])

  const unit = units.find((u) => u.slug === unitSlug)
  if (!unit) return null
  // A unit's public page is offline unless it is publicly live — inferred from
  // its appointment agenda + configured hours (PRD Identidade v2 — per-unit,
  // no stored publish flag), even if siblings are live.
  if (!isUnitPubliclyLive(unit)) return null

  let unitServices = serviceItems.filter(
    (s) => Array.isArray(s.unitIds) && s.unitIds.includes(unit.id),
  )

  let professional: Professional | null = null
  if (opts.professionalId) {
    const candidate = professionals.find((p) => p.id === opts.professionalId) ?? null
    if (
      candidate &&
      candidate.unitIds.includes(unit.id) &&
      isOperational(candidate.operationalStatus)
    ) {
      professional = candidate
      const proServiceIds = new Set(candidate.catalogServiceIds ?? [])
      unitServices = unitServices.filter((s) => proServiceIds.has(s.id))
    } else {
      unitServices = []
    }
  }

  // Unified public projection (brief 0023, AC-08 → 0053/B3): the unit's
  // kind-service items projected via `toPublicCatalogItem` — one shape for the
  // public catalog, sanitized + per-unit resolved.
  const catalogServiceItems = unitServices.map((s) => toPublicCatalogItem(s, unit.id))
  return {
    org,
    unit,
    units,
    catalogServiceItems,
    professional,
  }
}
