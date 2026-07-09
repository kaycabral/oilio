import { ChargeConfig } from '@/domain/aggregates/charge/config'
import { CommissionConfig } from '@/domain/aggregates/commission/config'
import { OrderConfig } from '@/domain/aggregates/order/config'
import { aggregateRef, appendEvent, type PersistencePort } from '@/domain/effect'
import { PostgresPersistenceLayer } from '@/shared/db/pg/effect/postgres-layer'
import { closeEventStoreDb, getEventStorePool } from '@/shared/db/pg/pool'
import { Effect } from 'effect'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { getPartialContributionMargin } from './contribution-margin.repo'
import { readOrgLedger } from './ledger.repo'

const ORG = 'org-razao'
const UNIT = 'unit-razao'

function pool() {
  return getEventStorePool()
}

async function seedParents(): Promise<void> {
  await pool().query(
    `INSERT INTO orgs (org_id, id, last_event_version, name, slug, vertical, owner_user_id, branding, created_at, updated_at)
     VALUES ($1,$1,1,'Org','slug-'||$1,'barbershop','owner','{}'::jsonb,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')
     ON CONFLICT (org_id) DO NOTHING`,
    [ORG],
  )
  await pool().query(
    `INSERT INTO units (org_id, id, last_event_version, name, slug, timezone, agenda_mode, fiscal_kind, address, agenda, fiscal, created_at, updated_at)
     VALUES ($1,$2,1,'Unit','unit-'||$2,'America/Sao_Paulo','always_open','informal','{"postalCode":"01310100","state":"SP","city":"São Paulo","neighborhood":"Bela Vista","street":"Avenida Paulista","number":"1000","complement":null}'::jsonb,'{}'::jsonb,'{}'::jsonb,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')
     ON CONFLICT (org_id, id) DO NOTHING`,
    [ORG, UNIT],
  )
  await pool().query(
    `INSERT INTO customers (org_id, id, last_event_version, user_id, archived_at, deactivated_at, created_at, updated_at)
     VALUES ($1,'cust-1',1,'user-cust-1',NULL,NULL,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')
     ON CONFLICT (org_id, id) DO NOTHING`,
    [ORG],
  )
  await pool().query(
    `INSERT INTO subscriptions (org_id, id, unit_id, last_event_version, customer_id, customer_user_id, status, billing_cycle, cancel_at_period_end, past_due_cycles, past_due_threshold, next_charge_date, plan, current_period, created_at, updated_at)
     VALUES ($1,'sub-1',$2,1,'cust-1','user-cust-1','active','monthly',false,0,2,'2026-08-01T00:00:00Z',
       '{"planId":"p1","name":"Mensal","priceCents":9000,"billingCycle":"monthly","includedItemIds":[],"includedCategoryIds":[],"usageLimit":{"kind":"count","quantity":4}}'::jsonb,
       '{"startAt":"2026-07-01T00:00:00.000Z","endAt":"2026-08-01T00:00:00.000Z","consumed":0}'::jsonb,
       '2026-06-30T00:00:00Z','2026-06-30T00:00:00Z')
     ON CONFLICT (org_id, id) DO NOTHING`,
    [ORG, UNIT],
  )
}

const orderRef = (id: string) => aggregateRef(OrderConfig, ORG, id)
const commissionRef = (id: string) => aggregateRef(CommissionConfig, ORG, id)
const chargeRef = (id: string) => aggregateRef(ChargeConfig, ORG, id)

const run = <A, E>(eff: Effect.Effect<A, E, PersistencePort>) =>
  Effect.runPromise(eff.pipe(Effect.provide(PostgresPersistenceLayer)))

const SALE_ITEM = {
  id: 'item-1',
  kind: 'service' as const,
  refId: 'svc-corte',
  name: 'Corte',
  quantity: 1,
  unitPriceCents: 5000,
  commission: null,
  attributedUserId: 'pro-1',
}

const CLOSED_AT = '2026-07-10T13:00:00.000Z'
const PERIOD_START = '2026-07-01T00:00:00.000Z'
const PAID_AT = '2026-08-04T10:00:00.000Z'

async function seedScenario(): Promise<void> {
  await run(
    appendEvent(OrderConfig, orderRef('ord-1'), {
      _tag: 'order.created',
      actorId: 'staff-1',
      payload: {
        data: {
          id: 'ord-1',
          orgId: ORG,
          unitId: UNIT,
          customerId: null,
          appointmentId: null,
          status: 'open',
          items: [],
          discountCents: 0,
          closedAt: null,
          paymentMethod: null,
          subtotalCents: 0,
          totalCents: 0,
          createdAt: '2026-07-10T12:00:00.000Z',
          updatedAt: '2026-07-10T12:00:00.000Z',
        },
      },
    }),
  )
  await run(
    appendEvent(OrderConfig, orderRef('ord-1'), {
      _tag: 'order.item_added',
      actorId: 'staff-1',
      payload: { changes: { items: [SALE_ITEM], subtotalCents: 5000, totalCents: 5000 } },
    }),
  )
  await run(
    appendEvent(OrderConfig, orderRef('ord-1'), {
      _tag: 'order.closed',
      actorId: 'staff-1',
      payload: {
        closedAt: CLOSED_AT,
        subtotalCents: 5000,
        totalCents: 5000,
        paymentMethod: 'cash',
        items: [SALE_ITEM],
        unitId: UNIT,
      },
    }),
  )

  await run(
    appendEvent(CommissionConfig, commissionRef('com-1'), {
      _tag: 'commission.created',
      actorId: 'system',
      payload: {
        data: {
          id: 'com-1',
          orgId: ORG,
          orderId: 'ord-1',
          orderItemId: 'item-1',
          attributedUserId: 'pro-1',
          attributedMemberName: 'Zé Profissional',
          itemKind: 'service',
          itemName: 'Corte',
          itemTotalCents: 5000,
          commissionKind: 'percentage',
          commissionValue: 40,
          amountCents: 2000,
          createdAt: CLOSED_AT,
        },
      },
    }),
  )

  await run(
    appendEvent(ChargeConfig, chargeRef('chg-1'), {
      _tag: 'charge.created',
      actorId: 'system',
      payload: {
        data: {
          id: 'chg-1',
          orgId: ORG,
          unitId: UNIT,
          subscriptionId: 'sub-1',
          customerId: 'cust-1',
          amountCents: 9000,
          periodStartAt: PERIOD_START,
          periodEndAt: '2026-08-01T00:00:00.000Z',
          dueDate: PERIOD_START,
          status: 'scheduled',
          attempts: 0,
          paidAt: null,
          failedAt: null,
          failureReason: null,
          refundedAt: null,
          lastActorUid: null,
          createdAt: '2026-06-30T00:00:00.000Z',
          updatedAt: '2026-06-30T00:00:00.000Z',
        },
      },
    }),
  )
  await run(
    appendEvent(ChargeConfig, chargeRef('chg-1'), {
      _tag: 'charge.succeeded',
      actorId: 'system',
      payload: {
        changes: {
          status: 'paid',
          paidAt: PAID_AT,
          attempts: 1,
          periodStartAt: PERIOD_START,
          amountCents: 9000,
          unitId: UNIT,
          updatedAt: PAID_AT,
        },
      },
    }),
  )
}

const JULY = { orgId: ORG, fromIso: '2026-07-01T00:00:00.000Z', toIso: '2026-08-01T00:00:00.000Z' }

describe('Razão deriva do event stream por competência (brief 0091, ADR 0016)', () => {
  beforeEach(async () => {
    await pool().query('DELETE FROM events WHERE org_id = $1', [ORG])
    await pool().query('DELETE FROM projections WHERE org_id = $1', [ORG])
    await pool()
      .query('DELETE FROM commissions WHERE org_id = $1', [ORG])
      .catch(() => undefined)
    await pool()
      .query('DELETE FROM charges WHERE org_id = $1', [ORG])
      .catch(() => undefined)
    await seedParents()
    await seedScenario()
  })

  afterAll(async () => {
    await pool().query('DELETE FROM events WHERE org_id = $1', [ORG])
    await closeEventStoreDb()
  })

  it('occurred_at é gravado por competência no append (writeEvent → competenceOf)', async () => {
    const res = await pool().query<{ tag: string; occurred_at: string | null }>(
      `SELECT envelope->>'_tag' AS tag, occurred_at FROM events WHERE org_id = $1 ORDER BY occurred_at NULLS FIRST`,
      [ORG],
    )
    const byTag = new Map(res.rows.map((r) => [r.tag, r.occurred_at]))
    expect(byTag.get('order.created')).toBeNull()
    expect(byTag.get('order.item_added')).toBeNull()
    expect(new Date(byTag.get('order.closed')!).toISOString()).toBe(CLOSED_AT)
    expect(new Date(byTag.get('commission.created')!).toISOString()).toBe(CLOSED_AT)
    expect(new Date(byTag.get('charge.succeeded')!).toISOString()).toBe(PERIOD_START)
  })

  it('readOrgLedger deriva receita (venda + assinatura) e CSP (comissão) do stream', async () => {
    const ledger = await readOrgLedger(JULY)

    const saleRevenue = ledger.find((e) => e.source === 'order' && e.direction === 'in')
    expect(saleRevenue).toMatchObject({
      nature: 'revenue',
      unitId: UNIT,
      amountCents: 5000,
      occurredAt: CLOSED_AT,
    })

    const csp = ledger.find((e) => e.nature === 'csp')
    expect(csp).toMatchObject({
      nature: 'csp',
      direction: 'out',
      unitId: UNIT,
      amountCents: 2000,
      occurredAt: CLOSED_AT,
    })

    const subRevenue = ledger.find((e) => e.source === 'charge' && e.direction === 'in')
    expect(subRevenue).toMatchObject({
      nature: 'revenue',
      amountCents: 9000,
      occurredAt: PERIOD_START,
    })
  })

  it('a janela é por competência: uma assinatura paga em agosto entra no Razão de JULHO', async () => {
    const july = await readOrgLedger(JULY)
    expect(july.some((e) => e.source === 'charge')).toBe(true)

    const august = await readOrgLedger({
      orgId: ORG,
      fromIso: '2026-08-01T00:00:00.000Z',
      toIso: '2026-09-01T00:00:00.000Z',
    })
    expect(august.some((e) => e.source === 'charge')).toBe(false)
  })

  it('getPartialContributionMargin = receita − CSP, derivada só do Razão (cuts.ts)', async () => {
    const mc = await getPartialContributionMargin(JULY)
    expect(mc.revenueCents).toBe(14000)
    expect(mc.variableCostCents).toBe(2000)
    expect(mc.marginCents).toBe(12000)
    expect(mc.partial).toBe(true)
  })

  it('estorno cross-window: order.reopened em agosto estorna a venda de julho (snapshot no evento)', async () => {
    await run(
      appendEvent(OrderConfig, orderRef('ord-1'), {
        _tag: 'order.reopened',
        actorId: 'staff-1',
        payload: {
          reopenedAt: '2026-08-03T09:00:00.000Z',
          reversedClosedAt: CLOSED_AT,
          reversedRevenueCents: 5000,
          unitId: UNIT,
          commissionsReversed: 1,
          cashReversalMovementId: null,
          subscriptionRestored: false,
        },
      }),
    )

    const august = await readOrgLedger({
      orgId: ORG,
      fromIso: '2026-08-01T00:00:00.000Z',
      toIso: '2026-09-01T00:00:00.000Z',
    })
    const reversal = august.find((e) => e.source === 'order' && e.direction === 'out')
    expect(reversal).toMatchObject({
      nature: 'revenue',
      direction: 'out',
      amountCents: 5000,
      unitId: UNIT,
      occurredAt: '2026-08-03T09:00:00.000Z',
    })
    const july = await readOrgLedger(JULY)
    expect(july.some((e) => e.source === 'order' && e.direction === 'in')).toBe(true)
    expect(july.some((e) => e.source === 'order' && e.direction === 'out')).toBe(false)
  })
})
