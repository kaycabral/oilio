import { Category } from '@/domain'
import { type CategoryRow, rowToDoc } from '@/shared/db/pg/effect/category-projector'
import { readUnderRls } from '@/shared/db/pg/rls-read'
import { Schema } from 'effect'

const decodeCategory = Schema.decodeUnknownSync(Category)

export async function listCategoriesForOrg(orgId: string): Promise<Category[]> {
  const rows = await readUnderRls<CategoryRow>(orgId, (client) =>
    client
      .query<CategoryRow>('SELECT * FROM categories WHERE org_id = $1 ORDER BY name', [orgId])
      .then((res) => res.rows),
  )
  return rows.map((r) => decodeCategory(rowToDoc(r)))
}

export async function getCategoryById(orgId: string, categoryId: string): Promise<Category | null> {
  const rows = await readUnderRls<CategoryRow>(orgId, (client) =>
    client
      .query<CategoryRow>('SELECT * FROM categories WHERE org_id = $1 AND id = $2', [
        orgId,
        categoryId,
      ])
      .then((res) => res.rows),
  )
  const row = rows[0]
  return row ? decodeCategory(rowToDoc(row)) : null
}
