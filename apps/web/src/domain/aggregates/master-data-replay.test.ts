import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { docKey, makeReplayStore } from '@/domain/effect/test-layers'
import { aggregateRef } from '../effect/aggregate-ref'
import { appendEvent, replayAggregate, type AggregateConfig } from '../effect/event-store'
import { CatalogItemConfig } from './catalog-item/config'
import { CategoryConfig } from './category/config'
import { CustomerConfig } from './customer/config'
import { InviteConfig } from './invite/config'
import { MemberOperationConfig } from './member-operation/config'
import { OrgConfig } from './org/config'
import { SubscriptionPlanConfig } from './subscription-plan/config'
import { UnitConfig } from './unit/config'

async function checkReplay<
  State extends { readonly _version: number },
  Event extends { readonly _tag: string },
>({
  config,
  tag,
  id,
  data,
  changes,
}: {
  config: AggregateConfig<State, Event>
  tag: string
  id: string
  data: Record<string, unknown>
  changes: Record<string, unknown>
}): Promise<void> {
  const { store, layer } = makeReplayStore()
  const ref = aggregateRef(config, 't1', id)

  await Effect.runPromise(
    Effect.gen(function* () {
      yield* appendEvent(config, ref, {
        _tag: `${tag}.created`,
        actorId: 'actor-1',
        payload: { data },
      })
      yield* appendEvent(config, ref, {
        _tag: `${tag}.updated`,
        actorId: 'actor-1',
        payload: { changes },
      })
    }).pipe(Effect.provide(layer)),
  )

  const projection = store.get(docKey(ref))!
  const replayed = await Effect.runPromise(replayAggregate(config, ref).pipe(Effect.provide(layer)))

  expect(replayed).toEqual(projection)
  expect(replayed._version).toBe(2)
}

describe('Cadastros — replay reconstrói o doc completo (event-first)', () => {
  it('unit', () =>
    checkReplay({
      config: UnitConfig,
      tag: 'unit',
      id: 'u1',
      data: {
        id: 'u1',
        orgId: 't1',
        name: 'Centro',
        slug: 'centro',
        address: {
          postalCode: '01310-100',
          state: 'SP',
          city: 'São Paulo',
          neighborhood: 'Bela Vista',
          street: 'Av. Paulista',
          number: '1000',
          complement: null,
        },
        timezone: 'America/Sao_Paulo',
        agenda: {
          mode: 'fixed',
          businessHours: {
            monday: { open: '09:00', close: '18:00' },
            tuesday: { open: '09:00', close: '18:00' },
            wednesday: { open: '09:00', close: '18:00' },
            thursday: { open: '09:00', close: '18:00' },
            friday: { open: '09:00', close: '18:00' },
            saturday: null,
            sunday: null,
          },
        },
        archivedAt: null,
        fiscal: { kind: 'informal' },
        createdAt: '2026-06-01T12:00:00.000Z',
        updatedAt: '2026-06-01T12:00:00.000Z',
      },
      changes: { name: 'Centro Novo', slug: 'centro-novo' },
    }))

  it('member_operation', () =>
    checkReplay({
      config: MemberOperationConfig,
      tag: 'member_operation',
      id: 'pro1',
      data: {
        id: 'pro1',
        orgId: 't1',
        userId: 'u-pro1',
        defaultCommission: null,
        unitIds: ['u1'],
        catalogServiceIds: ['s1'],
        createdAt: '2026-06-01T12:00:00.000Z',
        updatedAt: '2026-06-01T12:00:00.000Z',
      },
      changes: { catalogServiceIds: ['s1', 's2'] },
    }))

  it('customer', () =>
    checkReplay({
      config: CustomerConfig,
      tag: 'customer',
      id: 'c1',
      data: {
        id: 'c1',
        orgId: 't1',
        userId: 'user-1',
        archivedAt: null,
        deactivatedAt: null,
        acquisition: null,
        createdAt: '2026-06-01T12:00:00.000Z',
        updatedAt: '2026-06-01T12:00:00.000Z',
      },
      changes: { deactivatedAt: '2026-06-02T12:00:00.000Z' },
    }))

  it('subscription_plan', () =>
    checkReplay({
      config: SubscriptionPlanConfig,
      tag: 'subscription_plan',
      id: 'plan1',
      data: {
        id: 'plan1',
        orgId: 't1',
        name: 'Mensal',
        description: null,
        priceCents: 9000,
        billingCycle: 'monthly',
        includedItemIds: ['svc-corte'],
        includedCategoryIds: ['corte'],
        usageLimit: { kind: 'unlimited' },
        active: true,
        archivedAt: null,
        createdAt: '2026-06-01T12:00:00.000Z',
        updatedAt: '2026-06-01T12:00:00.000Z',
      },
      changes: { priceCents: 10000, unitAllowlist: null },
    }))

  it('invite', () =>
    checkReplay({
      config: InviteConfig,
      tag: 'invite',
      id: 'i1',
      data: {
        id: 'i1',
        orgId: 't1',
        role: 'manager',
        tokenHash: 'h',
        expiresAt: '2026-07-01T00:00:00.000Z',
        status: 'pending',
        invitedBy: 'owner',
        acceptedByUid: null,
        acceptedAt: null,
        createdAt: '2026-06-01T12:00:00.000Z',
        updatedAt: '2026-06-01T12:00:00.000Z',
      },
      changes: { status: 'revoked' },
    }))

  it('org', () =>
    checkReplay({
      config: OrgConfig,
      tag: 'org',
      id: 't1',
      data: {
        id: 't1',
        name: 'Barbearia',
        slug: 'barbearia',
        vertical: 'barbershop',
        ownerUserId: 'owner-1',
        branding: { logoUrl: null, bannerUrl: null, description: null },
        createdAt: '2026-06-01T12:00:00.000Z',
        updatedAt: '2026-06-01T12:00:00.000Z',
      },
      changes: { name: 'Barbearia do Zé' },
    }))

  it('unit — agenda transition to appointment (event-first, per-unit)', async () => {
    const { store, layer } = makeReplayStore()
    const ref = aggregateRef(UnitConfig, 't2', 'u2')
    const HOURS = {
      monday: { open: '09:00', close: '18:00' },
      tuesday: null,
      wednesday: null,
      thursday: null,
      friday: null,
      saturday: null,
      sunday: null,
    }
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* appendEvent(UnitConfig, ref, {
          _tag: 'unit.created',
          actorId: 'owner-2',
          payload: {
            data: {
              id: 'u2',
              orgId: 't2',
              name: 'Centro',
              slug: 'centro',
              address: {
                postalCode: '01310-100',
                state: 'SP',
                city: 'São Paulo',
                neighborhood: 'Bela Vista',
                street: 'Av. Paulista',
                number: '1000',
                complement: null,
              },
              timezone: 'America/Sao_Paulo',
              agenda: { mode: 'fixed', businessHours: HOURS },
              archivedAt: null,
              fiscal: { kind: 'informal' },
              createdAt: '2026-06-01T12:00:00.000Z',
              updatedAt: '2026-06-01T12:00:00.000Z',
            },
          },
        })
        yield* appendEvent(UnitConfig, ref, {
          _tag: 'unit.updated',
          actorId: 'owner-2',
          payload: {
            changes: {
              agenda: {
                mode: 'appointment',
                businessHours: HOURS,
                slotMinutes: 15,
                cancellationPolicy: { enabled: false, minNoticeMinutes: 0 },
                confirmationTemplates: { confirmation: '', reminder: '', cancellation: '' },
              },
            },
          },
        })
      }).pipe(Effect.provide(layer)),
    )

    const afterUpdate = await Effect.runPromise(
      replayAggregate(UnitConfig, ref).pipe(Effect.provide(layer)),
    )
    expect(afterUpdate).toEqual(store.get(docKey(ref)))
    expect(afterUpdate.agenda.mode).toBe('appointment')
    expect(afterUpdate._version).toBe(2)
  })
})

describe('Cadastros — archive flag é event-first (brief 0027)', () => {
  async function checkArchive<
    State extends { readonly _version: number; readonly archivedAt: string | null },
    Event extends { readonly _tag: string },
  >(
    config: AggregateConfig<State, Event>,
    tag: string,
    id: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    const { store, layer } = makeReplayStore()
    const ref = aggregateRef(config, 't1', id)
    const archivedAt = '2026-06-01T12:00:00.000Z'

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* appendEvent(config, ref, {
          _tag: `${tag}.created`,
          actorId: 'actor-1',
          payload: { data },
        })
        yield* appendEvent(config, ref, {
          _tag: `${tag}.archived`,
          actorId: 'actor-1',
          payload: { archivedAt },
        })
      }).pipe(Effect.provide(layer)),
    )

    const afterArchive = await Effect.runPromise(
      replayAggregate(config, ref).pipe(Effect.provide(layer)),
    )
    expect(afterArchive).toEqual(store.get(docKey(ref)))
    expect(afterArchive.archivedAt).toBe(archivedAt)
    expect(afterArchive._version).toBe(2)

    await Effect.runPromise(
      appendEvent(config, ref, {
        _tag: `${tag}.archived`,
        actorId: 'actor-1',
        payload: { archivedAt: null },
      }).pipe(Effect.provide(layer)),
    )
    const afterRestore = await Effect.runPromise(
      replayAggregate(config, ref).pipe(Effect.provide(layer)),
    )
    expect(afterRestore).toEqual(store.get(docKey(ref)))
    expect(afterRestore.archivedAt).toBeNull()
    expect(afterRestore._version).toBe(3)
  }

  it('unit', () =>
    checkArchive(UnitConfig, 'unit', 'u1', {
      id: 'u1',
      orgId: 't1',
      name: 'Centro',
      slug: 'centro',
      address: {
        postalCode: '01310-100',
        state: 'SP',
        city: 'São Paulo',
        neighborhood: 'Bela Vista',
        street: 'Av. Paulista',
        number: '1000',
        complement: null,
      },
      timezone: 'America/Sao_Paulo',
      agenda: {
        mode: 'fixed',
        businessHours: {
          monday: { open: '09:00', close: '18:00' },
          tuesday: { open: '09:00', close: '18:00' },
          wednesday: { open: '09:00', close: '18:00' },
          thursday: { open: '09:00', close: '18:00' },
          friday: { open: '09:00', close: '18:00' },
          saturday: null,
          sunday: null,
        },
      },
      archivedAt: null,
      fiscal: { kind: 'informal' },
      createdAt: '2026-06-01T12:00:00.000Z',
      updatedAt: '2026-06-01T12:00:00.000Z',
    }))

  it('subscription_plan', () =>
    checkArchive(SubscriptionPlanConfig, 'subscription_plan', 'plan1', {
      id: 'plan1',
      orgId: 't1',
      name: 'Mensal',
      description: null,
      priceCents: 9000,
      billingCycle: 'monthly',
      includedItemIds: [],
      includedCategoryIds: [],
      usageLimit: { kind: 'unlimited' },
      active: true,
      archivedAt: null,
      createdAt: '2026-06-01T12:00:00.000Z',
      updatedAt: '2026-06-01T12:00:00.000Z',
    }))

  it('catalog_item', () =>
    checkArchive(CatalogItemConfig, 'catalog_item', 'ci1', {
      id: 'ci1',
      orgId: 't1',
      kind: 'service',
      name: 'Corte',
      categoryId: null,
      priceCents: 5000,
      commission: null,
      unitIds: ['u1'],
      unitOverrides: null,
      publicVisible: false,
      priceVisibility: 'visible',
      active: true,
      durationMinutes: 30,
      requiredResources: [],
      archivedAt: null,
      createdAt: '2026-06-01T12:00:00.000Z',
      updatedAt: '2026-06-01T12:00:00.000Z',
    }))

  it('category', () =>
    checkArchive(CategoryConfig, 'category', 'cat1', {
      id: 'cat1',
      orgId: 't1',
      name: 'Cabelo',
      icon: null,
      color: null,
      active: true,
      archivedAt: null,
      createdAt: '2026-06-01T12:00:00.000Z',
      updatedAt: '2026-06-01T12:00:00.000Z',
    }))
})
