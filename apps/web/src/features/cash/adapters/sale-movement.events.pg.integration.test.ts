import { closeEventStoreDb, getEventStorePool } from '@/shared/db/pg/pool'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { recordSaleMovement } from './sale-movement'

// Integration test for the I/O part of the cash adapter (brief 0065 § Grupo B,
// AC-04). `recordSaleMovement` emits `cash_movement.created`; the reducer
// projects the row into `cash_movements` in the same tx. This proves the
// standalone cash path (brief 0015 — caixa sem sessão) actually lands a row
// against real Postgres, complementing the pure shape test in `sale-movement.test.ts`.
//
// globalSetup applies the migrations; OILIO_DATABASE_URL is the ephemeral `oilio`
// database (docker locally, services:postgres in CI).

const ORG = 't1'

// Parent rows the new D2/0068 FKs require: the org, the unit (cash_movements
// .unit_id → units), and the order (cash_movements.order_id → orders; deferrable,
// but still checked at commit when non-null).
async function seedOrg(orgId: string): Promise<void> {
  await getEventStorePool().query(
    `INSERT INTO orgs (aggregate_path, org_id, id, version, name, slug, vertical, owner_user_id, branding, created_at, updated_at)
     VALUES ('orgs/'||$1,$1,$1,1,'Org','slug-'||$1,'barbershop','owner','{}'::jsonb,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')
     ON CONFLICT (aggregate_path) DO NOTHING`,
    [orgId],
  )
}

async function seedUnit(orgId: string, unitId: string): Promise<void> {
  await getEventStorePool().query(
    `INSERT INTO units (aggregate_path, org_id, id, version, name, slug, timezone, agenda_mode, fiscal_kind, address, agenda, fiscal, created_at, updated_at)
     VALUES ('orgs/'||$1||'/units/'||$2,$1,$2,1,'Unit','unit-'||$2,'America/Sao_Paulo','always_open','informal','{}'::jsonb,'{}'::jsonb,'{}'::jsonb,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')
     ON CONFLICT (aggregate_path) DO NOTHING`,
    [orgId, unitId],
  )
}

async function seedOrder(orgId: string, orderId: string, unitId: string): Promise<void> {
  await getEventStorePool().query(
    `INSERT INTO orders (aggregate_path, org_id, id, unit_id, version, customer_id, appointment_id, status, closed_at, payment_method, discount_cents, subtotal_cents, total_cents, items, created_at, updated_at)
     VALUES ('orgs/'||$1||'/orders/'||$2,$1,$2,$3,1,NULL,NULL,'open',NULL,NULL,0,0,0,'[]'::jsonb,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')
     ON CONFLICT (aggregate_path) DO NOTHING`,
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
      'SELECT kind, direction, amount_cents, order_id FROM cash_movements WHERE aggregate_path = $1',
      [`orgs/${ORG}/cash_movements/${movementId}`],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]?.kind).toBe('sale')
    expect(rows[0]?.direction).toBe('in')
    expect(Number(rows[0]?.amount_cents)).toBe(5000)
    expect(rows[0]?.order_id).toBe('o1')
  })
})
