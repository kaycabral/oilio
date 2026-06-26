// Unit tests pro server action `changeSubscriptionPlan` (ADR 0010, D5 / AC-07).
//
// A troca de plano é event-first: a action emite `subscription.plan_changed`
// com um snapshot FRESCO do plano de destino (via `buildPlanSnapshot`) — nunca
// write direto. O teste assere o domain event emitido + as guardas (RBAC,
// assinatura cancelada, mesmo plano, plano inexistente/inativo).
//
// Pós-cutover (#1202) Postgres é o único backend: a assinatura é lida do
// projection tipado via `readUnderRls` (mockado pra devolver uma row já no
// shape de projector) e o plano de destino via `getSubscriptionPlanById`
// (mockado). `emitEvent` é mockado (sem DB). `buildPlanSnapshot` roda de verdade
// (é puro) pra garantir que o payload carrega um snapshot real.

import { beforeEach, describe, expect, it, vi } from 'vitest'

type EmitArgs = [unknown, string, { _tag: string; payload: Record<string, unknown> }]

const mocks = vi.hoisted(() => ({
  requireManagerCtx: vi.fn(),
  readUnderRls: vi.fn(),
  getSubscriptionPlanById: vi.fn(),
  emitEvent: vi.fn((..._args: EmitArgs) => Promise.resolve({ ok: true as const })),
}))

vi.mock('@/shared/org/membership', () => ({
  requireManagerCtx: mocks.requireManagerCtx,
  requireOwnerCtx: vi.fn(),
}))

vi.mock('@/shared/db/pg/rls-read', () => ({ readUnderRls: mocks.readUnderRls }))
vi.mock('@/shared/org/subscription-plan-read', () => ({
  getSubscriptionPlanById: mocks.getSubscriptionPlanById,
}))
vi.mock('@/shared/effect-bridge', () => ({ emitEvent: mocks.emitEvent }))
vi.mock('@/features/notifications/adapters/reactor-dispatch', () => ({
  dispatchNotificationReactions: vi.fn(() => Promise.resolve(undefined)),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { changeSubscriptionPlan } from './subscriptions.actions'

function makeCtx() {
  return {
    ok: true as const,
    ctx: {
      session: { uid: 'user-1' },
      membership: { orgId: 'org-1', role: 'owner' as const, userId: 'user-1' },
    },
  }
}

const CURRENT_PLAN_SNAPSHOT = {
  planId: 'plan-a',
  name: 'Plano A',
  priceCents: 9000,
  billingCycle: 'monthly' as const,
  includedItemIds: ['svc-corte'],
  includedCategoryIds: ['corte'],
  usageLimit: { kind: 'unlimited' as const },
}

// A typed `subscriptions` projection row (the shape `readUnderRls` returns and
// `subscriptionRowToDoc`+decode round-trips). `getSubscriptionById` SELECTs by
// `aggregate_path`, so a single row stands for the looked-up subscription.
function subscriptionRow({
  status,
  plan = CURRENT_PLAN_SNAPSHOT,
}: {
  status: string
  plan?: unknown
}) {
  const cancelled = status === 'cancelled' || status === 'cancelled_for_non_payment'
  return {
    org_id: 'org-1',
    id: 'sub-1',
    unit_id: 'u1',
    last_event_version: 1,
    customer_id: 'c1',
    customer_user_id: 'user-9',
    status,
    billing_cycle: 'monthly',
    cancel_at_period_end: false,
    next_charge_date: null,
    past_due_cycles: 0,
    past_due_threshold: 2,
    cancellation_reason: null,
    cancelled_at: cancelled ? '2026-06-01T00:00:00.000Z' : null,
    plan,
    current_period: {
      startAt: '2026-06-01T00:00:00.000Z',
      endAt: '2026-07-01T00:00:00.000Z',
      consumed: 0,
    },
    created_at: '2026-06-01T00:00:00.000Z',
    updated_at: '2026-06-01T00:00:00.000Z',
  }
}

// Stub the subscription read (`readUnderRls`) + the target-plan read
// (`getSubscriptionPlanById`). `subscription === null` → no row (not found).
function stubReads({ subscription, plan }: { subscription: unknown; plan?: unknown }) {
  mocks.readUnderRls.mockResolvedValue(subscription === null ? [] : [subscription])
  mocks.getSubscriptionPlanById.mockResolvedValue(plan ?? null)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('changeSubscriptionPlan', () => {
  it('rejeita se RBAC falha', async () => {
    mocks.requireManagerCtx.mockResolvedValue({ ok: false, error: 'Sem permissão' })
    expect(await changeSubscriptionPlan('sub-1', 'plan-b')).toEqual({
      ok: false,
      error: 'Sem permissão',
    })
  })

  it('rejeita planId vazio', async () => {
    mocks.requireManagerCtx.mockResolvedValue(makeCtx())
    const r = await changeSubscriptionPlan('sub-1', '   ')
    expect(r).toEqual({ ok: false, error: 'Plano de destino é obrigatório' })
  })

  it('rejeita assinatura inexistente', async () => {
    mocks.requireManagerCtx.mockResolvedValue(makeCtx())
    stubReads({ subscription: null })
    const r = await changeSubscriptionPlan('sub-1', 'plan-b')
    expect(r).toEqual({ ok: false, error: 'Assinatura não encontrada' })
  })

  it('rejeita assinatura cancelada', async () => {
    mocks.requireManagerCtx.mockResolvedValue(makeCtx())
    stubReads({
      subscription: subscriptionRow({ status: 'cancelled' }),
      plan: { id: 'plan-b', active: true },
    })
    const r = await changeSubscriptionPlan('sub-1', 'plan-b')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('cancelada')
  })

  it('rejeita troca para o mesmo plano (idempotente)', async () => {
    mocks.requireManagerCtx.mockResolvedValue(makeCtx())
    stubReads({
      subscription: subscriptionRow({ status: 'active' }),
      plan: { id: 'plan-a', active: true },
    })
    const r = await changeSubscriptionPlan('sub-1', 'plan-a')
    expect(r).toEqual({ ok: false, error: 'Assinatura já está nesse plano' })
    expect(mocks.emitEvent).not.toHaveBeenCalled()
  })

  it('rejeita plano de destino inexistente', async () => {
    mocks.requireManagerCtx.mockResolvedValue(makeCtx())
    stubReads({ subscription: subscriptionRow({ status: 'active' }) })
    const r = await changeSubscriptionPlan('sub-1', 'plan-b')
    expect(r).toEqual({ ok: false, error: 'Plano de destino não encontrado' })
  })

  it('rejeita plano de destino inativo', async () => {
    mocks.requireManagerCtx.mockResolvedValue(makeCtx())
    stubReads({
      subscription: subscriptionRow({ status: 'active' }),
      plan: { id: 'plan-b', active: false },
    })
    const r = await changeSubscriptionPlan('sub-1', 'plan-b')
    expect(r).toEqual({ ok: false, error: 'Plano de destino está inativo' })
  })

  it('fluxo feliz: emite plan_changed com snapshot fresco do plano de destino', async () => {
    mocks.requireManagerCtx.mockResolvedValue(makeCtx())
    stubReads({
      subscription: subscriptionRow({ status: 'active' }),
      plan: {
        id: 'plan-b',
        orgId: 'org-1',
        name: 'Plano B',
        description: null,
        active: true,
        archivedAt: null,
        priceCents: 15000,
        billingCycle: 'quarterly',
        includedItemIds: ['svc-corte', 'svc-barba'],
        includedCategoryIds: ['corte', 'barba'],
        usageLimit: { kind: 'unlimited' },
        createdAt: '2026-06-01T00:00:00.000Z',
        updatedAt: '2026-06-01T00:00:00.000Z',
      },
    })

    const r = await changeSubscriptionPlan('sub-1', 'plan-b')
    expect(r).toEqual({ ok: true })

    expect(mocks.emitEvent).toHaveBeenCalledTimes(1)
    const call = mocks.emitEvent.mock.calls[0]
    if (!call) throw new Error('emitEvent not called')
    const [, path, event] = call
    expect(path).toBe('orgs/org-1/subscriptions/sub-1')
    expect(event._tag).toBe('subscription.plan_changed')
    const payload = event.payload
    expect(payload.planId).toBe('plan-b')
    expect(payload.changedBy).toBe('user-1')
    const plan = payload.plan
    if (typeof plan !== 'object' || plan === null)
      throw new Error('expected a plan snapshot object')
    const planRecord: Record<string, unknown> = { ...plan }
    expect(planRecord.planId).toBe('plan-b')
    expect(planRecord.priceCents).toBe(15000)
    expect(planRecord.includedItemIds).toEqual(['svc-corte', 'svc-barba'])
    // Preserva o ciclo de cobrança contratado (monthly), não o do plano destino.
    expect(planRecord.billingCycle).toBe('monthly')
  })
})
