import { CatalogItem } from '@/domain'
import { rowToDoc, type CatalogItemRow } from '@/shared/db/pg/effect/catalog-item-projector'
import { readUnderRls } from '@/shared/db/pg/rls-read'
import { Schema } from 'effect'
import 'server-only'

const decodeCatalogItem = Schema.decodeUnknownSync(CatalogItem)

function pgRowToItem(row: CatalogItemRow): CatalogItem {
  return decodeCatalogItem(rowToDoc(row))
}

export type ListCatalogItemsOptions = {
  readonly activeOnly?: boolean
  readonly categoryId?: string
}

export async function listCatalogItems(
  orgId: string,
  options: ListCatalogItemsOptions = {},
): Promise<CatalogItem[]> {
  const conds = ['org_id = $1']
  const params: unknown[] = [orgId]
  if (options.activeOnly) conds.push('active = true', 'archived_at IS NULL')
  if (options.categoryId !== undefined) {
    params.push(options.categoryId)
    conds.push(`category_id = $${params.length}`)
  }
  const rows = await readUnderRls<CatalogItemRow>(orgId, (client) =>
    client
      .query<CatalogItemRow>(
        `SELECT * FROM catalog_items WHERE ${conds.join(' AND ')} ORDER BY name`,
        params,
      )
      .then((res) => res.rows),
  )
  return rows.map(pgRowToItem)
}

export async function getCatalogItemById(
  orgId: string,
  itemId: string,
): Promise<CatalogItem | null> {
  const rows = await readUnderRls<CatalogItemRow>(orgId, (client) =>
    client
      .query<CatalogItemRow>('SELECT * FROM catalog_items WHERE org_id = $1 AND id = $2', [
        orgId,
        itemId,
      ])
      .then((res) => res.rows),
  )
  const row = rows[0]
  return row ? pgRowToItem(row) : null
}

export async function listCatalogItemIds(orgId: string): Promise<string[]> {
  const rows = await readUnderRls<{ id: string }>(orgId, (client) =>
    client
      .query<{ id: string }>('SELECT id FROM catalog_items WHERE org_id = $1', [orgId])
      .then((res) => res.rows),
  )
  return rows.map((r) => r.id)
}

export async function countActiveCatalogItemsInCategory(
  orgId: string,
  categoryId: string,
): Promise<number> {
  return countCatalogItemsInCategory(orgId, categoryId, { activeOnly: true })
}

export async function countCatalogItemsInCategory(
  orgId: string,
  categoryId: string,
  options: { activeOnly?: boolean } = {},
): Promise<number> {
  const archivedClause = options.activeOnly ? ' AND archived_at IS NULL' : ''
  const rows = await readUnderRls<{ n: number }>(orgId, (client) =>
    client
      .query<{ n: number }>(
        `SELECT count(*)::int AS n FROM catalog_items
       WHERE org_id = $1 AND category_id = $2${archivedClause}`,
        [orgId, categoryId],
      )
      .then((res) => res.rows),
  )
  return rows[0]?.n ?? 0
}
