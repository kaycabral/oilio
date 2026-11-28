import { closeEventStoreDb } from '@/shared/db/pg/pool'
import { ownerPool } from '@/shared/db/pg/test/owner-pool'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  sync: vi.fn<(orgId: string) => Promise<void>>(() => Promise.resolve(undefined)),
}))
vi.mock('@/shared/billing/stripe-sync', () => ({
  syncStripeSubscriptionQuantity: mocks.sync,
}))

import { reconcileBillingQuantities } from './reconcile-billing'

const APP_ROLE = 'oilio_reconcile_rls_app'
const APP_PASSWORD = 'rls_test'
const ownerUrl = process.env.OILIO_DATABASE_URL

async function seedOrg(id: string): Promise<void> {
  await ownerPool().query(
    `INSERT INTO orgs (org_id, id, last_event_version, name, slug, vertical, owner_user_id, branding, created_at, updated_at)
     VALUES ($1,$1,1,'Org','slug-'||$1,'barbershop','owner','{}'::jsonb,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')
     ON CONFLICT (org_id) DO NOTHING`,
    [id],
  )
}

async function seedBilling(
  orgId: string,
  opts: { status: string; subId: string | null },
): Promise<void> {
  await seedOrg(orgId)
  await ownerPool().query(
    `INSERT INTO org_billing
       (org_id, id, last_event_version, tier, status, billing_cycle, unit_quantity,
        stripe_customer_id, stripe_subscription_id, cancel_at_period_end, created_at, updated_at)
     VALUES ($1,$1,1,'pro',$2,'monthly',1,'cus_'||$1,$3,false,
             '2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`,
    [orgId, opts.status, opts.subId],
  )
  await ownerPool().query(
    `INSERT INTO org_billing_stripe_index (stripe_customer_id, org_id) VALUES ('cus_'||$1, $1)`,
    [orgId],
  )
}

async function asRuntimeRole<T>(fn: () => Promise<T>): Promise<T> {
  if (!ownerUrl) throw new Error('OILIO_DATABASE_URL is required')
  await closeEventStoreDb()
  process.env.OILIO_DATABASE_URL = ownerUrl.replace(/\/\/[^@]+@/, `//${APP_ROLE}:${APP_PASSWORD}@`)
  try {
    return await fn()
  } finally {
    await closeEventStoreDb()
    process.env.OILIO_DATABASE_URL = ownerUrl
  }
}

describe('reconcileBillingQuantities (brief 0074, AC-04)', () => {
  beforeAll(async () => {
    const pool = ownerPool()
    await pool.query(`DROP OWNED BY ${APP_ROLE}`).catch(() => undefined)
    await pool.query(`DROP ROLE IF EXISTS ${APP_ROLE}`).catch(() => undefined)
    await pool.query(`CREATE ROLE ${APP_ROLE} LOGIN PASSWORD '${APP_PASSWORD}' NOBYPASSRLS`)
    await pool.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON orgs, org_billing, org_billing_stripe_index TO ${APP_ROLE}`,
    )
  })

  beforeEach(async () => {
    vi.clearAllMocks()
    await ownerPool().query('TRUNCATE org_billing_stripe_index, org_billing, orgs CASCADE')
  })

  afterAll(async () => {
    const pool = ownerPool()
    await pool.query(`DROP OWNED BY ${APP_ROLE}`).catch(() => undefined)
    await pool.query(`DROP ROLE IF EXISTS ${APP_ROLE}`).catch(() => undefined)
    await closeEventStoreDb()
  })

  it('sweeps only orgs with a live subscription (active/trialing/past_due + sub id)', async () => {
    await seedBilling('org-active', { status: 'active', subId: 'sub_a' })
    await seedBilling('org-trialing', { status: 'trialing', subId: 'sub_t' })
    await seedBilling('org-pastdue', { status: 'past_due', subId: 'sub_p' })
    await seedBilling('org-canceled', { status: 'canceled', subId: 'sub_c' })
    await seedBilling('org-nosub', { status: 'active', subId: null })

    const swept = await reconcileBillingQuantities()

    expect(swept).toBe(3)
    expect(mocks.sync).toHaveBeenCalledTimes(3)
    const orgIds = mocks.sync.mock.calls.map((c) => c[0]).sort()
    expect(orgIds).toEqual(['org-active', 'org-pastdue', 'org-trialing'])
  })

  it('still sees every live org as the runtime role (no BYPASSRLS, FORCE RLS on org_billing)', async () => {
    await seedBilling('org-1', { status: 'active', subId: 'sub_1' })
    await seedBilling('org-2', { status: 'past_due', subId: 'sub_2' })
    await seedBilling('org-3', { status: 'canceled', subId: 'sub_3' })

    const swept = await asRuntimeRole(() => reconcileBillingQuantities())

    expect(swept).toBe(2)
    expect(mocks.sync.mock.calls.map((c) => c[0]).sort()).toEqual(['org-1', 'org-2'])
  })

  it('returns 0 and calls nothing when no org has a subscription', async () => {
    await seedBilling('org-free', { status: 'active', subId: null })

    const swept = await reconcileBillingQuantities()

    expect(swept).toBe(0)
    expect(mocks.sync).not.toHaveBeenCalled()
  })
})
