import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { product } from '../schema'
import { closeDb, getDb, runMigrations } from './pool'
import { PostgresProductSource } from './repository'

const VALID_GTIN14 = '04006381333931'
const OTHER_GTIN14 = '00036000291452'

function baseProduct(gtin14: string) {
  return { gtin14, name: 'Café torrado 500g', source: 'official' as const }
}

function readStringProp(value: unknown, key: string): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  if (!(key in value)) return undefined
  const prop: unknown = Reflect.get(value, key)
  return typeof prop === 'string' ? prop : undefined
}

function pgCause(error: unknown): unknown {
  if (typeof error === 'object' && error !== null && 'cause' in error) {
    return Reflect.get(error, 'cause')
  }
  return error
}

async function expectPgViolation(
  run: () => Promise<unknown>,
  code: string,
  constraint?: string,
): Promise<void> {
  try {
    await run()
  } catch (error) {
    const pg = pgCause(error)
    expect(readStringProp(pg, 'code')).toBe(code)
    if (constraint !== undefined) expect(readStringProp(pg, 'constraint')).toBe(constraint)
    return
  }
  throw new Error(`expected a Postgres ${code} violation, but the query succeeded`)
}

beforeAll(async () => {
  await runMigrations()
})

afterAll(async () => {
  await closeDb()
})

beforeEach(async () => {
  await getDb().delete(product)
})

describe('Product table — migration + connection', () => {
  it('applies the schema from migrations and round-trips a row', async () => {
    const source = new PostgresProductSource()
    const stored = await source.upsert(baseProduct(VALID_GTIN14))
    expect(stored.gtin14).toBe(VALID_GTIN14)
    expect(stored.source).toBe('official')
    expect(stored.createdAt).toBeInstanceOf(Date)

    const found = await source.findByGtin14(VALID_GTIN14)
    expect(found?.name).toBe('Café torrado 500g')
    expect(await source.findByGtin14(OTHER_GTIN14)).toBeNull()
  })
})

describe('Product table — native constraints reject invalid data', () => {
  it('UNIQUE: a duplicate GTIN-14 is refused by the database', async () => {
    await getDb().insert(product).values(baseProduct(VALID_GTIN14))
    await expectPgViolation(
      () => getDb().insert(product).values(baseProduct(VALID_GTIN14)),
      '23505',
    )
  })

  it('NOT NULL: a row without a GTIN is refused by the database', async () => {
    await expectPgViolation(
      () => getDb().execute(sql`INSERT INTO product (name, source) VALUES ('No GTIN', 'official')`),
      '23502',
    )
  })

  it('NOT NULL: a row without a name is refused by the database', async () => {
    await expectPgViolation(
      () =>
        getDb().execute(
          sql`INSERT INTO product (gtin14, source) VALUES (${VALID_GTIN14}, 'official')`,
        ),
      '23502',
    )
  })

  it('enum: a source outside the enum is refused by the database', async () => {
    await expectPgViolation(
      () =>
        getDb().execute(
          sql`INSERT INTO product (gtin14, name, source) VALUES (${VALID_GTIN14}, 'Bad source', 'made-up')`,
        ),
      '22P02',
    )
  })

  it('CHECK: a non-normalized (not 14-digit) key is refused by the database', async () => {
    await expectPgViolation(
      () =>
        getDb().execute(
          sql`INSERT INTO product (gtin14, name, source) VALUES ('123', 'Too short', 'official')`,
        ),
      '23514',
      'product_gtin14_is_14_digits',
    )
  })

  it('CHECK: a blank name is refused by the database', async () => {
    await expectPgViolation(
      () =>
        getDb().execute(
          sql`INSERT INTO product (gtin14, name, source) VALUES (${VALID_GTIN14}, '   ', 'official')`,
        ),
      '23514',
      'product_name_not_blank',
    )
  })
})

describe('Product table — idempotency by GTIN-14 (UNIQUE key)', () => {
  it('upsert on the same GTIN-14 updates instead of duplicating', async () => {
    const source = new PostgresProductSource()
    await source.upsert(baseProduct(VALID_GTIN14))
    const updated = await source.upsert({
      ...baseProduct(VALID_GTIN14),
      name: 'Café torrado 1kg',
      source: 'org-contributed',
    })

    expect(updated.name).toBe('Café torrado 1kg')
    expect(updated.source).toBe('org-contributed')

    const rows = await getDb().select().from(product)
    expect(rows).toHaveLength(1)
  })
})
