import {
  type CatalogServiceItem,
  isCatalogService,
  isOperational,
  isReservedSlug,
  isReservedUnitSlug,
  isValidSlug,
  isValidUnitSlug,
  type MemberOperation,
  type Org,
  type PublicCatalogItem,
  toPublicCatalogItem,
  type Unit,
} from '@/domain'
import { isUnitPubliclyLive } from '@/features/units/core/publish-readiness'
import { listCatalogItems } from '@/shared/db/effect/catalog-item-read'
import { listCategoriesForOrg } from '@/shared/org/category-read'
import { listMemberOperationsForOrg } from '@/shared/org/member-operation-read'
import { getOrgBySlug } from '@/shared/org/org'
import { listUnitsForOrg } from '@/shared/org/unit-read'
import 'server-only'

export type PublicOrgBundle = {
  org: Org
  catalogServiceItems: CatalogServiceItem[]
}

export type PublicOrgSummary = {
  org: Org
  units: Unit[]
}

export type PublicUnitBundle = {
  org: Org
  unit: Unit
  units: Unit[]
  catalogServiceItems: PublicCatalogItem[]
  memberOperation: MemberOperation | null
}

async function loadOrgUnits(orgId: string): Promise<Unit[]> {
  return listUnitsForOrg(orgId)
}

async function loadPublicCatalogServiceItems(orgId: string): Promise<CatalogServiceItem[]> {
  const items = await listCatalogItems(orgId)
  return items.filter(isCatalogService).filter((s) => s.active && s.publicVisible)
}

export async function getPublicOrgBundle(slug: string): Promise<PublicOrgBundle | null> {
  if (!isValidSlug(slug) || isReservedSlug(slug)) return null

  const org = await getOrgBySlug(slug)
  if (!org) return null
  const units = await loadOrgUnits(org.id)
  if (!units.some(isUnitPubliclyLive)) return null

  const catalogServiceItems = await loadPublicCatalogServiceItems(org.id)
  return { org, catalogServiceItems }
}

export async function getPublicOrgSummary(slug: string): Promise<PublicOrgSummary | null> {
  if (!isValidSlug(slug) || isReservedSlug(slug)) return null

  const org = await getOrgBySlug(slug)
  if (!org) return null

  const units = (await loadOrgUnits(org.id)).filter(isUnitPubliclyLive)
  if (units.length === 0) return null
  return { org, units }
}

export async function getPublicUnitBundle(
  slug: string,
  unitSlug: string,
  opts: { memberOperationId?: string | null } = {},
): Promise<PublicUnitBundle | null> {
  if (!isValidSlug(slug) || isReservedSlug(slug)) return null
  if (!isValidUnitSlug(unitSlug) || isReservedUnitSlug(unitSlug)) return null

  const org = await getOrgBySlug(slug)
  if (!org) return null

  const [units, serviceItems, memberOperations, categories] = await Promise.all([
    loadOrgUnits(org.id),
    loadPublicCatalogServiceItems(org.id),
    listMemberOperationsForOrg(org.id),
    listCategoriesForOrg(org.id),
  ])

  const unit = units.find((u) => u.slug === unitSlug)
  if (!unit) return null
  if (!isUnitPubliclyLive(unit)) return null

  let unitServices = serviceItems.filter(
    (s) => Array.isArray(s.unitIds) && s.unitIds.includes(unit.id),
  )

  let memberOperation: MemberOperation | null = null
  if (opts.memberOperationId) {
    const candidate = memberOperations.find((p) => p.id === opts.memberOperationId) ?? null
    if (
      candidate &&
      candidate.unitIds.includes(unit.id) &&
      isOperational(candidate.operationalStatus)
    ) {
      memberOperation = candidate
      const proServiceIds = new Set(candidate.catalogServiceIds ?? [])
      unitServices = unitServices.filter((s) => proServiceIds.has(s.id))
    } else {
      unitServices = []
    }
  }

  const categoryNameById = new Map(
    categories.filter((c) => !c.archivedAt).map((c) => [c.id, c.name]),
  )

  const catalogServiceItems = unitServices.map((s) =>
    toPublicCatalogItem(s, unit.id, categoryNameById),
  )
  return {
    org,
    unit,
    units,
    catalogServiceItems,
    memberOperation,
  }
}
