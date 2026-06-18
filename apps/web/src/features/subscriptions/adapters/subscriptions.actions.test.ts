// Unit tests pro server action `changeSubscriptionPlan` (ADR 0010, D5 / AC-07).
//
// A troca de plano é event-first: a action emite `subscription.plan_changed`
// com um snapshot FRESCO do plano de destino (via `buildPlanSnapshot`) — nunca
// write direto. O teste assere o domain event emitido + as guardas (RBAC,
// assinatura cancelada, mesmo plano, plano inexistente/inativo).
//
// Firebase Admin + emitEvent são mockados (sem emulator). `buildPlanSnapshot`
// roda de verdade (é puro) pra garantir que o payload carrega um snapshot real.

import { beforeEach, describe, expect, it, vi } from 'vitest'

type EmitArgs = [unknown, string, { _tag: string; payload: Record<string, unknown> }]

const mocks = vi.hoisted(() => ({
  requireManagerCtx: vi.fn(),
  getAdminFirestore: vi.fn(),
  emitEvent: vi.fn((..._args: EmitArgs) => Promise.resolve({ ok: true as const })),
}))

vi.mock('@/shared/org/membership', () => ({
  requireManagerCtx: mocks.requireManagerCtx,
  requireOwnerCtx: vi.fn(),
}))

vi.mock('@/shared/db', () => ({ getAdminFirestore: mocks.getAdminFirestore }))
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

function fakeDoc(data: unknown, exists = true) {
  return { exists, data: () => data }
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

// Chainable collection ref: the migrated adapter calls
// `orgRef.collection(name).withConverter(fsConverter(Schema)).doc(id).get()`.
// `withConverter` is a passthrough returning the same ref — the converter's
// `fromFirestore` is NOT invoked, so `snap.data()` yields the fixture untouched
// (which is what these partial-fixture guard tests rely on).
interface CollectionRef {
  withConverter: () => CollectionRef
  doc: (id: string) => { get: () => Promise<{ exists: boolean; data: () => unknown }> }
}

function fakeFirestore({ subscription, plan }: { subscription: unknown; plan?: unknown }) {
  const orgRef = {
    collection: (name: string): CollectionRef => {
      const ref: CollectionRef = {
        withConverter: () => ref,
        doc: (id: string) => {
          if (name === 'subscriptions' && id === 'sub-1') {
            return { get: () => Promise.resolve(fakeDoc(subscription, !!subscription)) }
          }
          if (name === 'subscription_plans') {
            return { get: () => Promise.resolve(fakeDoc(plan, !!plan)) }
          }
          return { get: () => Promise.resolve(fakeDoc(null, false)) }
        },
      }
      return ref
    },
  }
  return { collection: () => ({ doc: () => orgRef }) }
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
    mocks.getAdminFirestore.mockReturnValue(fakeFirestore({ subscription: null }))
    const r = await changeSubscriptionPlan('sub-1', 'plan-b')
    expect(r).toEqual({ ok: false, error: 'Assinatura não encontrada' })
  })

  it('rejeita assinatura cancelada', async () => {
    mocks.requireManagerCtx.mockResolvedValue(makeCtx())
    mocks.getAdminFirestore.mockReturnValue(
      fakeFirestore({
        subscription: { status: 'cancelled', plan: CURRENT_PLAN_SNAPSHOT },
        plan: { id: 'plan-b', active: true },
      }),
    )
    const r = await changeSubscriptionPlan('sub-1', 'plan-b')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('cancelada')
  })

  it('rejeita troca para o mesmo plano (idempotente)', async () => {
    mocks.requireManagerCtx.mockResolvedValue(makeCtx())
    mocks.getAdminFirestore.mockReturnValue(
      fakeFirestore({
        subscription: { status: 'active', plan: CURRENT_PLAN_SNAPSHOT },
        plan: { id: 'plan-a', active: true },
      }),
    )
    const r = await changeSubscriptionPlan('sub-1', 'plan-a')
    expect(r).toEqual({ ok: false, error: 'Assinatura já está nesse plano' })
    expect(mocks.emitEvent).not.toHaveBeenCalled()
  })

  it('rejeita plano de destino inexistente', async () => {
    mocks.requireManagerCtx.mockResolvedValue(makeCtx())
    mocks.getAdminFirestore.mockReturnValue(
      fakeFirestore({ subscription: { status: 'active', plan: CURRENT_PLAN_SNAPSHOT } }),
    )
    const r = await changeSubscriptionPlan('sub-1', 'plan-b')
    expect(r).toEqual({ ok: false, error: 'Plano de destino não encontrado' })
  })

  it('rejeita plano de destino inativo', async () => {
    mocks.requireManagerCtx.mockResolvedValue(makeCtx())
    mocks.getAdminFirestore.mockReturnValue(
      fakeFirestore({
        subscription: { status: 'active', plan: CURRENT_PLAN_SNAPSHOT },
        plan: { id: 'plan-b', active: false },
      }),
    )
    const r = await changeSubscriptionPlan('sub-1', 'plan-b')
    expect(r).toEqual({ ok: false, error: 'Plano de destino está inativo' })
  })

  it('fluxo feliz: emite plan_changed com snapshot fresco do plano de destino', async () => {
    mocks.requireManagerCtx.mockResolvedValue(makeCtx())
    mocks.getAdminFirestore.mockReturnValue(
      fakeFirestore({
        subscription: { status: 'active', plan: CURRENT_PLAN_SNAPSHOT },
        plan: {
          id: 'plan-b',
          name: 'Plano B',
          active: true,
          priceCents: 15000,
          billingCycle: 'quarterly',
          includedItemIds: ['svc-corte', 'svc-barba'],
          includedCategoryIds: ['corte', 'barba'],
          usageLimit: { kind: 'unlimited' },
        },
      }),
    )

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
