import type { FirestoreDoc, SagaStep, TransactionContext } from '@/domain/effect'
import type { Charge } from '@/domain/types/charge'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import {
  buildMarkFailedSteps,
  buildMarkPaidSteps,
  buildRenewSteps,
} from './subscription-charges-saga'

// Runs the built steps against an in-memory tx so the step closures (the arrow
// bodies calling appendEventToTx) actually execute — proving the cascade writes
// land and covering the closure branches. The real ACID/rollback behavior lives
// in `charge-subscription-saga-acid.events.pg.integration.test.ts` (#1200).
async function runSteps(steps: SagaStep[]): Promise<Map<string, FirestoreDoc>> {
  const store = new Map<string, FirestoreDoc>()
  const tx: TransactionContext = {
    getDoc: (path) => Effect.succeed(store.get(path) ?? null),
    setDoc: (path, data) =>
      Effect.sync(() => {
        store.set(path, { ...store.get(path), ...data })
      }),
    deleteDoc: (path) =>
      Effect.sync(() => {
        store.delete(path)
      }),
  }
  for (const step of steps) await Effect.runPromise(step(tx))
  return store
}

const ORG = 't1'
const SUB = 'sub1'
const CHARGE = 'ch1'

const renewCharge: Charge = {
  id: 'ch2',
  orgId: ORG,
  unitId: 'unit-a',
  subscriptionId: SUB,
  customerId: 'c1',
  amountCents: 9900,
  periodStartAt: '2026-07-01T00:00:00.000Z',
  periodEndAt: '2026-08-01T00:00:00.000Z',
  dueDate: '2026-07-01T00:00:00.000Z',
  status: 'scheduled',
  attempts: 0,
  paidAt: null,
  failedAt: null,
  failureReason: null,
  lastActorUid: null,
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
}

describe('buildMarkPaidSteps', () => {
  const base = {
    orgId: ORG,
    actorId: 'actor',
    chargeId: CHARGE,
    subscriptionId: SUB,
    attempts: 0,
    now: '2026-06-02T00:00:00.000Z',
  }

  it('settles the subscription alongside the charge when not cancelled', () => {
    const steps = buildMarkPaidSteps({ ...base, settle: true })
    expect(steps).toHaveLength(2)
  })

  it('marks only the charge when the subscription is cancelled', () => {
    const steps = buildMarkPaidSteps({ ...base, settle: false })
    expect(steps).toHaveLength(1)
  })

  it('the built steps write charge.paid + the settle, incrementing attempts', async () => {
    const store = await runSteps(buildMarkPaidSteps({ ...base, attempts: 1, settle: true }))
    expect(store.get(`orgs/${ORG}/charges/${CHARGE}`)).toMatchObject({
      status: 'paid',
      attempts: 2,
    })
    expect(store.get(`orgs/${ORG}/subscriptions/${SUB}`)).toBeDefined()
  })
})

describe('buildMarkFailedSteps', () => {
  const base = {
    orgId: ORG,
    actorId: 'actor',
    chargeId: CHARGE,
    subscriptionId: SUB,
    now: '2026-06-02T00:00:00.000Z',
    nextChargeStatus: 'failed' as const,
    nextChargeAttempts: 3,
    subStatus: 'past_due' as const,
    failureReason: 'card_declined',
  }

  it('always stacks charge.failed then subscription.charge_failed', () => {
    expect(buildMarkFailedSteps(base)).toHaveLength(2)
  })

  it('the built steps write the failure to both aggregates', async () => {
    const store = await runSteps(buildMarkFailedSteps(base))
    expect(store.get(`orgs/${ORG}/charges/${CHARGE}`)).toMatchObject({
      failureReason: 'card_declined',
      attempts: 3,
    })
    expect(store.get(`orgs/${ORG}/subscriptions/${SUB}`)).toBeDefined()
  })

  it('falls back to manual_mark when no reason is given', async () => {
    const store = await runSteps(buildMarkFailedSteps({ ...base, failureReason: null }))
    expect(store.get(`orgs/${ORG}/charges/${CHARGE}`)).toMatchObject({ failureReason: null })
  })

  it('below threshold writes a recovering charge (not the invalid past_due) (#1201)', async () => {
    const store = await runSteps(
      buildMarkFailedSteps({ ...base, nextChargeStatus: 'recovering', nextChargeAttempts: 1 }),
    )
    expect(store.get(`orgs/${ORG}/charges/${CHARGE}`)).toMatchObject({
      status: 'recovering',
      attempts: 1,
    })
  })
})

describe('buildRenewSteps', () => {
  const input = {
    orgId: ORG,
    actorId: 'actor',
    subscriptionId: SUB,
    charge: renewCharge,
    periodStart: '2026-07-01T00:00:00.000Z',
    periodEnd: '2026-08-01T00:00:00.000Z',
    nextChargeDate: '2026-08-01T00:00:00.000Z',
  }

  it('stacks the new charge.created then subscription.renewed', () => {
    expect(buildRenewSteps(input)).toHaveLength(2)
  })

  it('the built steps create the next charge and renew the period', async () => {
    const store = await runSteps(buildRenewSteps(input))
    expect(store.get(`orgs/${ORG}/charges/ch2`)).toMatchObject({ status: 'scheduled' })
    expect(store.get(`orgs/${ORG}/subscriptions/${SUB}`)).toBeDefined()
  })
})
