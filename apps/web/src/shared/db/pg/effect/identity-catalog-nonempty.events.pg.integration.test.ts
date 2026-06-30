import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { closeEventStoreDb, getEventStorePool } from '../pool'

/**
 * Proof that the DB rejects the zero-value on identity/catalog required fields
 * (#1283, brief 0078 Group C): a unit with a blank address, a `company` unit
 * with an empty `taxId`, and a catalog item with `unit_ids = []`. Runs against
 * the ephemeral Postgres over the superuser pool (CHECK enforced regardless of
 * RLS). The `unit.created` decode (`CompleteAddress`) is the domain-side layer;
 * this proves the DB layer.
 */

const ORG = 'org-id-cat'

const COMPLETE_ADDRESS = JSON.stringify({
  postalCode: '01310100',
  state: 'SP',
  city: 'São Paulo',
  neighborhood: 'Bela Vista',
  street: 'Av. Paulista',
  number: '1000',
  complement: null,
})
const BLANK_ADDRESS = JSON.stringify({
  postalCode: '',
  state: '',
  city: '',
  neighborhood: '',
  street: '',
  number: null,
  complement: null,
})

async function seedOrg(id: string): Promise<void> {
  await getEventStorePool().query(
    `INSERT INTO orgs (org_id, id, last_event_version, name, slug, vertical, owner_user_id, branding, created_at, updated_at)
     VALUES ($1,$1,1,'Org','slug-'||$1,'barbershop','owner','{}'::jsonb,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`,
    [id],
  )
}

// Insert a units row with the given address + fiscal JSONB.
function insertUnit(
  id: string,
  address: string,
  fiscalKind: 'informal' | 'company',
  fiscal: string,
): Promise<unknown> {
  return getEventStorePool().query(
    `INSERT INTO units
       (org_id, id, last_event_version, name, slug, timezone, agenda_mode, fiscal_kind,
        address, agenda, fiscal, created_at, updated_at)
     VALUES ($1,$2,1,'Unit','slug-'||$2,'America/Sao_Paulo','fixed',$3,
        $4::jsonb,'{"mode":"fixed","businessHours":{}}'::jsonb,$5::jsonb,
        '2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`,
    [ORG, id, fiscalKind, address, fiscal],
  )
}

function insertCatalogItem(id: string, unitIds: string): Promise<unknown> {
  return getEventStorePool().query(
    `INSERT INTO catalog_items
       (org_id, id, last_event_version, kind, name, price_cents, price_visibility,
        active, public_visible, duration_minutes, unit_ids, created_at, updated_at)
     VALUES ($1,$2,1,'service','Corte',5000,'visible',true,true,30,$3::jsonb,
        '2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`,
    [ORG, id, unitIds],
  )
}

beforeAll(async () => {
  await cleanup()
  await seedOrg(ORG)
})

async function cleanup(): Promise<void> {
  await getEventStorePool().query(`DELETE FROM catalog_items WHERE org_id = $1`, [ORG])
  await getEventStorePool().query(`DELETE FROM units WHERE org_id = $1`, [ORG])
  await getEventStorePool().query(`DELETE FROM orgs WHERE org_id = $1`, [ORG])
}

beforeEach(async () => {
  await getEventStorePool().query(`DELETE FROM catalog_items WHERE org_id = $1`, [ORG])
  await getEventStorePool().query(`DELETE FROM units WHERE org_id = $1`, [ORG])
})

afterAll(async () => {
  await cleanup()
  await closeEventStoreDb()
})

describe('identity/catalog non-empty constraints (#1283 Group C)', () => {
  it('rejects a unit with a blank address (AC-05)', async () => {
    await expect(
      insertUnit('u-blank', BLANK_ADDRESS, 'informal', '{"kind":"informal"}'),
    ).rejects.toThrow(/units_address_complete/)
  })

  it('accepts a unit with a complete address', async () => {
    await expect(
      insertUnit('u-ok', COMPLETE_ADDRESS, 'informal', '{"kind":"informal"}'),
    ).resolves.toBeDefined()
  })

  it('rejects a company unit with an empty taxId (AC-07)', async () => {
    await expect(
      insertUnit('u-company-blank', COMPLETE_ADDRESS, 'company', '{"kind":"company","taxId":""}'),
    ).rejects.toThrow(/units_company_taxid_nonempty/)
  })

  it('accepts a company unit with a real taxId', async () => {
    await expect(
      insertUnit(
        'u-company-ok',
        COMPLETE_ADDRESS,
        'company',
        '{"kind":"company","taxId":"12345678000190"}',
      ),
    ).resolves.toBeDefined()
  })

  it('rejects a catalog item with empty unit_ids (AC-06)', async () => {
    await expect(insertCatalogItem('c-blank', '[]')).rejects.toThrow(
      /catalog_items_unit_ids_nonempty/,
    )
  })

  it('accepts a catalog item with at least one unit', async () => {
    await insertUnit('u-for-cat', COMPLETE_ADDRESS, 'informal', '{"kind":"informal"}')
    await expect(insertCatalogItem('c-ok', '["u-for-cat"]')).resolves.toBeDefined()
  })
})
