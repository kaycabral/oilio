import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeEventStoreDb, getEventStorePool } from '../pool'

/**
 * Cross-aggregate foreign-key proof against REAL Postgres (brief 0068 D2 — the
 * proof NEW to this phase). The relacionalização replaced the Firestore-era
 * id-by-convention refs with real composite FKs `(org_id, ref) → target(org_id,
 * id)`. This spec proves the DATABASE refuses a hard-delete of a parent row that
 * still has dependents (SQLSTATE `23503`) — the last-line guard the delete server
 * actions (AC-02) convert into a friendly message via `isForeignKeyViolation`.
 *
 * Seeding runs over the superuser pool (bypassing RLS) so the fixtures exist; the
 * DELETE also runs there — the FK is enforced for owner and app role alike (a FK
 * is not an RLS policy). The assertions match SQLSTATE `23503` (the code the app
 * helper keys on), not a brittle message string.
 */

const FK_VIOLATION = '23503'
const ORG = 'fk-org'
const UNIT = 'fk-unit'
const CUSTOMER = 'fk-customer'
const PROFESSIONAL = 'fk-pro'
const SERVICE = 'fk-svc'
const SUBSCRIPTION = 'fk-sub'

function pool() {
  return getEventStorePool()
}

async function seedOrg(): Promise<void> {
  await pool().query(
    `INSERT INTO orgs (org_id, id, last_event_version, name, slug, vertical, owner_user_id, branding, created_at, updated_at)
     VALUES ($1,$1,1,'Org','slug-'||$1,'barbershop','owner','{}'::jsonb,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`,
    [ORG],
  )
}

async function seedUnit(id = UNIT): Promise<void> {
  await pool().query(
    `INSERT INTO units (org_id, id, last_event_version, name, slug, timezone, agenda_mode, fiscal_kind, address, agenda, fiscal, created_at, updated_at)
     VALUES ($1,$2,1,'Unit','unit-'||$2,'America/Sao_Paulo','always_open','informal','{}'::jsonb,'{}'::jsonb,'{}'::jsonb,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`,
    [ORG, id],
  )
}

async function seedCustomer(id = CUSTOMER): Promise<void> {
  await pool().query(
    `INSERT INTO customers (org_id, id, last_event_version, user_id, archived_at, deactivated_at, created_at, updated_at)
     VALUES ($1,$2,1,'user-'||$2,NULL,NULL,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`,
    [ORG, id],
  )
}

async function seedMemberOperation(id = PROFESSIONAL): Promise<void> {
  await pool().query(
    `INSERT INTO memberships (org_id, id, user_id, last_event_version, role, status, joined_at, permissions, updated_at)
     VALUES ($1,$1||'_'||('user-'||$2),'user-'||$2,1,'member_operator','active','2026-01-01T00:00:00Z','{}'::jsonb,'2026-01-01T00:00:00Z')
     ON CONFLICT (org_id, id) DO NOTHING`,
    [ORG, id],
  )
  await pool().query(
    `INSERT INTO member_operations (org_id, id, last_event_version, user_id, member_id, default_commission, unit_ids, catalog_service_ids, created_at, updated_at)
     VALUES ($1,$2,1,'user-'||$2,$1||'_'||('user-'||$2),NULL,'[]'::jsonb,'[]'::jsonb,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`,
    [ORG, id],
  )
}

async function seedService(id = SERVICE): Promise<void> {
  await pool().query(
    `INSERT INTO catalog_items (org_id, id, last_event_version, kind, name, category_id, price_cents, price_visibility, active, archived_at, duration_minutes, sku, stock, gtin14, reconciliation_pending, reconciliation_last_attempt, commission, unit_ids, unit_overrides, required_resources, public_visible, created_at, updated_at)
     VALUES ($1,$2,1,'service','Service',NULL,5000,'visible',true,NULL,30,NULL,NULL,NULL,NULL,NULL,NULL,'[]'::jsonb,NULL,NULL,false,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`,
    [ORG, id],
  )
}

async function seedSubscription(id = SUBSCRIPTION): Promise<void> {
  await pool().query(
    `INSERT INTO subscriptions (org_id, id, unit_id, last_event_version, customer_id, customer_user_id, status, billing_cycle, cancel_at_period_end, next_charge_date, past_due_cycles, past_due_threshold, cancellation_reason, cancelled_at, plan, current_period, created_at, updated_at)
     VALUES ($1,$2,$3,1,$4,NULL,'pending','monthly',false,NULL,0,3,NULL,NULL,'{}'::jsonb,'{}'::jsonb,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`,
    [ORG, id, UNIT, CUSTOMER],
  )
}

async function seedOrder(id: string): Promise<void> {
  await pool().query(
    `INSERT INTO orders (org_id, id, unit_id, last_event_version, customer_id, appointment_id, status, closed_at, payment_method, discount_cents, subtotal_cents, total_cents, items, created_at, updated_at)
     VALUES ($1,$2,$3,1,$4,NULL,'open',NULL,NULL,0,0,0,'[]'::jsonb,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`,
    [ORG, id, UNIT, CUSTOMER],
  )
}

async function seedAppointment(id: string): Promise<void> {
  await pool().query(
    `INSERT INTO appointments (org_id, id, unit_id, last_event_version, member_operation_id, customer_id, service_id, customer_user_id, member_operator_user_id, start_at, end_at, status, service_price_cents_snapshot, service_duration_minutes_snapshot, commission_snapshot, cancellation_policy_snapshot, tracking, created_at, updated_at, member_id)
     VALUES ($1,$2,$3,1,$4,$5,$6,'user-'||$5,NULL,'2026-01-02T10:00:00Z','2026-01-02T10:30:00Z','scheduled',5000,30,NULL,NULL,NULL,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z',(SELECT mo.member_id FROM member_operations mo WHERE mo.org_id = $1 AND mo.id = $4))`,
    [ORG, id, UNIT, PROFESSIONAL, CUSTOMER, SERVICE],
  )
}

async function seedCharge(id: string): Promise<void> {
  await pool().query(
    `INSERT INTO charges (org_id, id, unit_id, last_event_version, subscription_id, customer_id, amount_cents, period_start_at, period_end_at, due_date, status, attempts, paid_at, failed_at, failure_reason, last_actor_uid, created_at, updated_at)
     VALUES ($1,$2,$3,1,$4,$5,5000,'2026-01-01T00:00:00Z','2026-02-01T00:00:00Z','2026-01-05T00:00:00Z','scheduled',0,NULL,NULL,NULL,NULL,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`,
    [ORG, id, UNIT, SUBSCRIPTION, CUSTOMER],
  )
}

async function deleteRow(table: string, id: string): Promise<void> {
  await pool().query(`DELETE FROM ${table} WHERE org_id = $1 AND id = $2`, [ORG, id])
}

describe('cross-aggregate FK RESTRICT — proof against Postgres (brief 0068 D2)', () => {
  beforeEach(async () => {
    await pool().query(
      'TRUNCATE events, projections, orders, charges, subscriptions, appointments, commissions, cash_movements, catalog_items, member_operations, customers, units, orgs CASCADE',
    )
    await seedOrg()
    await seedUnit()
    await seedCustomer()
    await seedMemberOperation()
    await seedService()
  })

  afterAll(async () => {
    await closeEventStoreDb()
  })

  it('refuses deleting a unit that still has an appointment (23503)', async () => {
    await seedAppointment('appt-1')
    await expect(deleteRow('units', UNIT)).rejects.toMatchObject({ code: FK_VIOLATION })
  })

  it('refuses deleting a customer that still has an order (23503)', async () => {
    await seedOrder('order-1')
    await expect(deleteRow('customers', CUSTOMER)).rejects.toMatchObject({ code: FK_VIOLATION })
  })

  it('refuses deleting a memberOperation that still has an appointment (23503)', async () => {
    await seedAppointment('appt-1')
    await expect(deleteRow('member_operations', PROFESSIONAL)).rejects.toMatchObject({
      code: FK_VIOLATION,
    })
  })

  it('refuses deleting a catalog item still referenced by an appointment service (23503)', async () => {
    await seedAppointment('appt-1')
    await expect(deleteRow('catalog_items', SERVICE)).rejects.toMatchObject({ code: FK_VIOLATION })
  })

  it('refuses deleting a subscription that still has a charge (23503)', async () => {
    await seedSubscription()
    await seedCharge('charge-1')
    await expect(deleteRow('subscriptions', SUBSCRIPTION)).rejects.toMatchObject({
      code: FK_VIOLATION,
    })
  })

  it('allows deleting a unit with no dependents', async () => {
    const orphan = 'unit-orphan'
    await seedUnit(orphan)
    await expect(deleteRow('units', orphan)).resolves.toBeUndefined()
  })

  it('does NOT block a category delete (catalog_items.category_id is SET NULL, not RESTRICT)', async () => {
    // A category with a catalog item pointing at it can be deleted; the FK nulls
    // the child's `category_id` (re-buckets to "Sem categoria") instead of
    // refusing — the one cross-aggregate ref that is SET NULL by design.
    await pool().query(
      `INSERT INTO categories (org_id, id, last_event_version, name, active, created_at, updated_at)
       VALUES ($1,'cat-1',1,'Cat',true,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`,
      [ORG],
    )
    await pool().query(`UPDATE catalog_items SET category_id = 'cat-1' WHERE id = $1`, [SERVICE])
    await expect(deleteRow('categories', 'cat-1')).resolves.toBeUndefined()
    const { rows } = await pool().query<{ category_id: string | null }>(
      `SELECT category_id FROM catalog_items WHERE id = $1`,
      [SERVICE],
    )
    expect(rows[0]?.category_id).toBeNull()
  })
})
