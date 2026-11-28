import { sql } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { closeDb, getDb, product } from '@/product'

describe('product base runtime role (oilio_app, #80)', () => {
  afterAll(async () => {
    await closeDb()
  })

  it('connects as oilio_app with DML on the product table and nothing more', async () => {
    const db = getDb()
    const role = await db.execute<{ current_user: string; rolsuper: boolean; rolbypassrls: boolean }>(
      sql`SELECT current_user, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`,
    )
    expect(role.rows).toEqual([{ current_user: 'oilio_app', rolsuper: false, rolbypassrls: false }])

    await expect(db.select().from(product).limit(1)).resolves.toBeDefined()
    await expect(db.execute(sql`TRUNCATE product`)).rejects.toMatchObject({ cause: { code: '42501' } })
    await expect(db.execute(sql`ALTER TABLE product ADD COLUMN probe int`)).rejects.toMatchObject({
      cause: { code: '42501' },
    })
    await expect(db.execute(sql`CREATE TABLE public.runtime_probe (id int)`)).rejects.toMatchObject({
      cause: { code: '42501' },
    })
    await expect(
      db.execute(sql`SELECT * FROM drizzle.__drizzle_migrations_product`),
    ).rejects.toMatchObject({ cause: { code: '42501' } })
  })
})
