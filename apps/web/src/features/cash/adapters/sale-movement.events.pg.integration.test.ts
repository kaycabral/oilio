import { closeEventStoreDb, getEventStorePool } from '@/shared/db/pg/pool'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { recordSaleMovement } from './sale-movement'

const ORG = 't1'

async function seedOrg(orgId: string): Promise<void> {
  await getEventStorePool().query(
    `INSERT INTO orgs (org_id, id, last_event_version, name, slug, vertical, owner_user_id, branding, created_at, updated_at)
     VALUES ($1,$1,1,'Org','slug-'||$1,'barbershop','owner','{}'::jsonb,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')
     ON CONFLICT (org_id) DO NOTHING`,
    [orgId],
  )
}

async function seedUnit(orgId: string, unitId: string): Promise<void> {
  await getEventStorePool().query(
    `INSERT INTO units (org_id, id, last_event_version, name, slug, timezone, agenda_mode, fiscal_kind, address, agenda, fiscal, created_at, updated_at)
     VALUES ($1,$2,1,'Unit','unit-'||$2,'America/Sao_Paulo','always_open','informal','{"postalCode":"01310100","state":"SP","city":"São Paulo","neighborhood":"Bela Vista","street":"Avenida Paulista","number":"1000","complement":null}'::jsonb,'{}'::jsonb,'{}'::jsonb,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')
     ON CONFLICT (org_id, id) DO NOTHING`,
    [orgId, unitId],
  )
}

async function seedOrder(orgId: string, orderId: string, unitId: string): Promise<void> {
  await getEventStorePool().query(
    `INSERT INTO orders (org_id, id, unit_id, last_event_version, customer_id, appointment_id, status, closed_at, payment_method, discount_cents, subtotal_cents, total_cents, items, created_at, updated_at)
     VALUES ($1,$2,$3,1,NULL,NULL,'open',NULL,NULL,0,0,0,'[]'::jsonb,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')
     ON CONFLICT (org_id, id) DO NOTHING`,
    [orgId, orderId, unitId],
  )
}

describe('recordSaleMovement — Postgres', () => {
  beforeEach(async () => {
    await getEventStorePool().query(
      'TRUNCATE events, projections, cash_movements, orders, units, orgs CASCADE',
    )
    await seedOrg(ORG)
    await seedUnit(ORG, 'u1')
    await seedOrder(ORG, 'o1', 'u1')
  })
  afterAll(async () => {
    await closeEventStoreDb()
  })

  it('emits cash_movement.created and projects the sale row', async () => {
    const result = await recordSaleMovement({
      orgId: ORG,
      unitId: 'u1',
      orderId: 'o1',
      amountCents: 5000,
      paymentMethod: 'pix',
      actorUid: 'actor-1',
    })

    expect(result.ok).toBe(true)
    const movementId = result.ok ? result.movementId : ''

    const { rows } = await getEventStorePool().query<{
      kind: string
      direction: string
      amount_cents: string
      order_id: string
    }>(
      'SELECT kind, direction, amount_cents, order_id FROM cash_movements WHERE org_id = $1 AND id = $2',
      [ORG, movementId],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]?.kind).toBe('sale')
    expect(rows[0]?.direction).toBe('in')
    expect(Number(rows[0]?.amount_cents)).toBe(5000)
    expect(rows[0]?.order_id).toBe('o1')
  })
})
