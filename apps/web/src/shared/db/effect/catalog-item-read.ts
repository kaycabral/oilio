import { CatalogItem } from '@/domain'
import { rowToDoc, type CatalogItemRow } from '@/shared/db/pg/effect/catalog-item-projector'
import { readUnderRls } from '@/shared/db/pg/rls-read'
import { Schema } from 'effect'
import 'server-only'

/**
 * Reads of the `catalog_items` projection (brief 0058, AC-02/AC-04).
 *
 * This module centralizes every projection read of the typed `catalog_items`
 * table under RLS, so the whole CRUD cycle (create/list/filter/edit/archive/
 * delete + snapshot-on-use) runs against the event-store projection.
 *
 * Rows decode through the `CatalogItem` schema via `rowToDoc` (the inverse of the
 * typed projector's upsert) → `decodeCatalogItem`, so callers get one validated
 * shape (no cast leaks; the schema is the single source of truth).
 *
 * Snapshot-on-use (order-write-helpers) reads through `PersistencePort.getDoc`
 * already, so it is covered by the layer and not duplicated here.
 */

const decodeCatalogItem = Schema.decodeUnknownSync(CatalogItem)

function pgRowToItem(row: CatalogItemRow): CatalogItem {
  return decodeCatalogItem(rowToDoc(row))
}

export type ListCatalogItemsOptions = {
  /** Only items not archived AND `active = true` (the active-catalog read). */
  readonly activeOnly?: boolean
  /** Filter by category FK. */
  readonly categoryId?: string
}

/**
 * List an org's catalog items ordered by name. With `activeOnly`, returns only
 * active, non-archived items (the order-detail/public read); otherwise every
 * item (the manage-catalog read, which filters `archivedAt` at the call-site).
 */
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

/** Get a single catalog item by id, or `null` when it does not exist. */
export async function getCatalogItemById(
  orgId: string,
  itemId: string,
): Promise<CatalogItem | null> {
  const rows = await readUnderRls<CatalogItemRow>(orgId, (client) =>
    client
      .query<CatalogItemRow>('SELECT * FROM catalog_items WHERE aggregate_path = $1', [
        `orgs/${orgId}/catalog_items/${itemId}`,
      ])
      .then((res) => res.rows),
  )
  const row = rows[0]
  return row ? pgRowToItem(row) : null
}

/** All catalog-item ids for an org (FK existence checks; no full decode). */
export async function listCatalogItemIds(orgId: string): Promise<string[]> {
  const rows = await readUnderRls<{ id: string }>(orgId, (client) =>
    client
      .query<{ id: string }>('SELECT id FROM catalog_items WHERE org_id = $1', [orgId])
      .then((res) => res.rows),
  )
  return rows.map((r) => r.id)
}

/**
 * Count an org's NON-archived items in a category — the delete-confirm dialog's
 * "items re-bucketed to Sem categoria" warning (active items only; archived ones
 * aren't shown where the label matters). Counts in the DB on Postgres; mirrors
 * the Firestore `where + filter archived`.
 */
export async function countActiveCatalogItemsInCategory(
  orgId: string,
  categoryId: string,
): Promise<number> {
  return countCatalogItemsInCategory(orgId, categoryId, { activeOnly: true })
}

/**
 * Count an org's items in a category. With `activeOnly`, excludes archived items
 * (the dialog warning); without it, counts EVERY referencing item including
 * archived ones (the delete-vs-archive FK guard — an archived item still carries
 * `categoryId`, so hard-deleting the category would orphan that label).
 */
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
