import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { closeEventStoreDb } from '../pool'
import { ownerPool } from '@/shared/db/pg/test/owner-pool'

const ORG = 'org-fin-ne'
const UNIT = 'unit-fin'

const COMPLETE_ADDRESS = JSON.stringify({
  postalCode: '01310100',
  state: 'SP',
  city: 'SP',
  neighborhood: 'Centro',
  street: 'Rua A',
  number: '1',
  complement: null,
})

async function seedOrgAndUnit(): Promise<void> {
  const pool = ownerPool()
  await pool.query(
    `INSERT INTO orgs (org_id, id, last_event_version, name, slug, vertical, owner_user_id, branding, created_at, updated_at)
     VALUES ($1,$1,1,'Org','slug-'||$1,'barbershop','owner','{}'::jsonb,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`,
    [ORG],
  )
  await pool.query(
    `INSERT INTO units (org_id, id, last_event_version, name, slug, timezone, agenda_mode, fiscal_kind, address, agenda, fiscal, created_at, updated_at)
     VALUES ($1,$2,1,'Unit','slug-'||$2,'America/Sao_Paulo','fixed','informal',$3::jsonb,'{"mode":"fixed","businessHours":{}}'::jsonb,'{"kind":"informal"}'::jsonb,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`,
    [ORG, UNIT, COMPLETE_ADDRESS],
  )
  await pool.query(
    `INSERT INTO orders (org_id, id, last_event_version, unit_id, status, subtotal_cents, total_cents, discount_cents, items, created_at, updated_at)
     VALUES ($1,'order-1',1,$2,'open',0,0,0,'[]'::jsonb,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`,
    [ORG, UNIT],
  )
}

function insertCommission(
  id: string,
  orderItemId: string,
  attributedUserId: string,
  itemName: string,
): Promise<unknown> {
  return ownerPool().query(
    `INSERT INTO commissions
       (org_id, id, last_event_version, order_id, order_item_id, attributed_user_id,
        attributed_member_name, item_kind, item_name, item_total_cents, commission_kind,
        commission_value, amount_cents, liquidation_status, created_at)
     VALUES ($1,$2,1,'order-1',$3,$4,'Member','service',$5,1000,'percentage',10,100,'pendente',
        '2026-01-01T00:00:00Z')`,
    [ORG, id, orderItemId, attributedUserId, itemName],
  )
}

function insertCashMovement(id: string, recordedByUid: string): Promise<unknown> {
  return ownerPool().query(
    `INSERT INTO cash_movements
       (org_id, id, last_event_version, unit_id, kind, direction, amount_cents, recorded_by_uid, created_at)
     VALUES ($1,$2,1,$3,'suprimento','in',500,$4,'2026-01-01T00:00:00Z')`,
    [ORG, id, UNIT, recordedByUid],
  )
}

beforeAll(async () => {
  await cleanup()
  await seedOrgAndUnit()
})

async function cleanup(): Promise<void> {
  const pool = ownerPool()
  await pool.query(`DELETE FROM commissions WHERE org_id = $1`, [ORG])
  await pool.query(`DELETE FROM cash_movements WHERE org_id = $1`, [ORG])
  await pool.query(`DELETE FROM charges WHERE org_id = $1`, [ORG])
  await pool.query(`DELETE FROM orders WHERE org_id = $1`, [ORG])
  await pool.query(`DELETE FROM units WHERE org_id = $1`, [ORG])
  await pool.query(`DELETE FROM orgs WHERE org_id = $1`, [ORG])
}

beforeEach(async () => {
  await ownerPool().query(`DELETE FROM commissions WHERE org_id = $1`, [ORG])
  await ownerPool().query(`DELETE FROM cash_movements WHERE org_id = $1`, [ORG])
})

afterAll(async () => {
  await cleanup()
  await closeEventStoreDb()
})

describe('financial FK-less user-ids non-empty + charges unit FK (#1283 Group D)', () => {
  it('rejects empty commissions.order_item_id (AC-09)', async () => {
    await expect(insertCommission('c1', '', 'user-1', 'Corte')).rejects.toThrow(
      /commissions_order_item_id_nonempty/,
    )
  })

  it('rejects empty commissions.attributed_user_id (AC-09)', async () => {
    await expect(insertCommission('c2', 'item-1', '', 'Corte')).rejects.toThrow(
      /commissions_attributed_user_id_nonempty/,
    )
  })

  it('rejects empty commissions.item_name (AC-11)', async () => {
    await expect(insertCommission('c3', 'item-1', 'user-1', '')).rejects.toThrow(
      /commissions_item_name_nonempty/,
    )
  })

  it('accepts a commission with all FK-less ids non-empty', async () => {
    await expect(insertCommission('c4', 'item-1', 'user-1', 'Corte')).resolves.toBeDefined()
  })

  it('rejects empty cash_movements.recorded_by_uid (AC-09)', async () => {
    await expect(insertCashMovement('m1', '')).rejects.toThrow(
      /cash_movements_recorded_by_uid_nonempty/,
    )
  })

  it('accepts a cash movement with a real recorded_by_uid', async () => {
    await expect(insertCashMovement('m2', 'user-1')).resolves.toBeDefined()
  })
})
