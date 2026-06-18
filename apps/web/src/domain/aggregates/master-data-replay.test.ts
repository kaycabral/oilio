// AC-09/AC-10 (brief 0025) — replay reconstrói o doc completo dos cadastros.
// Para cada aggregate de cadastro: created (snapshot) → updated (changes) →
// replayAggregate == projeção, campo a campo. Prova que nenhum campo é escrito
// fora de eventos (event-first).

import { Effect, Layer } from 'effect'
import { describe, expect, it } from 'vitest'

import { appendEvent, replayAggregate, type AggregateConfig } from '../effect/event-store'
import type { FirestoreDoc } from '../effect/services'
import { FirestoreService } from '../effect/services'
import { CatalogItemConfig } from './catalog-item/config'
import { CategoryConfig } from './category/config'
import { CustomerConfig } from './customer/config'
import { InviteConfig } from './invite/config'
import { OrgConfig } from './org/config'
import { ProductConfig } from './product/config'
import { ProfessionalConfig } from './professional/config'
import { ServiceConfig } from './service/config'
import { SubscriptionPlanConfig } from './subscription-plan/config'
import { UnitConfig } from './unit/config'

function makeStore() {
  const store = new Map<string, FirestoreDoc>()
  return {
    store,
    layer: Layer.succeed(FirestoreService, {
      getDoc: (path: string) => Effect.succeed(store.get(path) ?? null),
      getDocs: (collectionPath: string) =>
        Effect.succeed(
          [...store.entries()]
            .filter(([key]) => key.startsWith(collectionPath + '/'))
            .map(([, doc]) => doc)
            .sort(
              (a, b) =>
                (typeof a['version'] === 'number' ? a['version'] : 0) -
                (typeof b['version'] === 'number' ? b['version'] : 0),
            ),
        ),
      setDoc: (path: string, data: FirestoreDoc) =>
        Effect.sync(() => {
          store.set(path, { ...store.get(path), ...data })
        }),
      runTransaction: (fn) =>
        fn({
          getDoc: (path) => Effect.succeed(store.get(path) ?? null),
          setDoc: (path, data) =>
            Effect.sync(() => {
              store.set(path, { ...store.get(path), ...data })
            }),
        }),
    }),
  }
}

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
  const { store, layer } = makeStore()
  const path = `orgs/t1/${tag}s/${id}`

  await Effect.runPromise(
    Effect.gen(function* () {
      yield* appendEvent(config, path, {
        _tag: `${tag}.created`,
        actorId: 'actor-1',
        payload: { data },
      })
      yield* appendEvent(config, path, {
        _tag: `${tag}.updated`,
        actorId: 'actor-1',
        payload: { changes },
      })
    }).pipe(Effect.provide(layer)),
  )

  const projection = store.get(path)!
  const replayed = await Effect.runPromise(
    replayAggregate(config, path).pipe(Effect.provide(layer)),
  )

  expect(replayed).toEqual(projection)
  expect(replayed._version).toBe(2)
}

describe('Cadastros — replay reconstrói o doc completo (event-first)', () => {
  it('unit', () =>
    // PII (whatsapp/email) lives in `units_pii`, never in the event payload
    // (LGPD — #1036). The projection carries only operational fields.
    checkReplay({
      config: UnitConfig,
      tag: 'unit',
      id: 'u1',
      data: {
        id: 'u1',
        orgId: 't1',
        name: 'Centro',
        slug: 'centro',
        // address/businessHours/hoursMode are REQUIRED in the v2 schema (PRD
        // Identidade) — the `unit.created` payload carries a real establishment
        // address and hours, not the null/absent state of the v1 auto-matriz.
        address: {
          postalCode: '01310-100',
          state: 'SP',
          city: 'São Paulo',
          neighborhood: 'Bela Vista',
          street: 'Av. Paulista',
          number: '1000',
          complement: null,
        },
        businessHours: {
          monday: { open: '09:00', close: '18:00' },
          tuesday: { open: '09:00', close: '18:00' },
          wednesday: { open: '09:00', close: '18:00' },
          thursday: { open: '09:00', close: '18:00' },
          friday: { open: '09:00', close: '18:00' },
          saturday: null,
          sunday: null,
        },
        hoursMode: 'fixed',
        archivedAt: null,
        createdAt: '2026-06-01T12:00:00.000Z',
        updatedAt: '2026-06-01T12:00:00.000Z',
      },
      changes: { name: 'Centro Novo', slug: 'centro-novo' },
    }))

  it('service', () =>
    checkReplay({
      config: ServiceConfig,
      tag: 'service',
      id: 's1',
      data: {
        id: 's1',
        orgId: 't1',
        name: 'Corte',
        priceCents: 5000,
        durationMinutes: 30,
        category: null,
        commission: null,
        requiredResources: [],
        active: true,
        publicVisible: false,
        priceVisibility: 'visible',
        unitIds: ['u1'],
        unitOverrides: null,
        createdAt: '2026-06-01T12:00:00.000Z',
        updatedAt: '2026-06-01T12:00:00.000Z',
      },
      changes: { priceCents: 6000 },
    }))

  it('product', () =>
    checkReplay({
      config: ProductConfig,
      tag: 'product',
      id: 'p1',
      data: {
        id: 'p1',
        orgId: 't1',
        name: 'Pomada',
        sku: null,
        priceCents: 3000,
        stock: 10,
        active: true,
        createdAt: '2026-06-01T12:00:00.000Z',
        updatedAt: '2026-06-01T12:00:00.000Z',
      },
      changes: { stock: 8 },
    }))

  it('professional', () =>
    // PII (name/whatsapp/email/taxIdentity) lives in `professionals_pii`,
    // never in the event payload (LGPD — #1036). The projection carries only
    // operational fields.
    checkReplay({
      config: ProfessionalConfig,
      tag: 'professional',
      id: 'pro1',
      data: {
        id: 'pro1',
        orgId: 't1',
        userId: 'u-pro1',
        operationalStatus: 'operational',
        defaultCommission: null,
        unitIds: ['u1'],
        serviceIds: ['s1'],
        createdAt: '2026-06-01T12:00:00.000Z',
        updatedAt: '2026-06-01T12:00:00.000Z',
      },
      changes: { serviceIds: ['s1', 's2'] },
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
    // PII (invitee email) lives in `invites_pii`, never in the event payload
    // (LGPD — #1036). The projection carries only operational fields.
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
    // PII (taxIdentity = owner CPF/CNPJ) lives in the deletable
    // `orgs/{id}/private/taxIdentity` doc, never in the event payload
    // (LGPD — #1036). `name` is the business name (not PII) and stays. The
    // projection carries only operational fields.
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
        fiscalProfile: { stage: 'informal' },
        selfBookingPublished: false,
        selfBookingPublishedAt: null,
        timezone: 'America/Sao_Paulo',
        slotMinutes: 15,
        branding: { logoUrl: null, bannerUrl: null, description: null },
        cancellationPolicy: { enabled: false, minNoticeMinutes: 0 },
        whatsappTemplates: { confirmation: '', reminder: '', cancellation: '' },
        createdAt: '2026-06-01T12:00:00.000Z',
        updatedAt: '2026-06-01T12:00:00.000Z',
      },
      changes: { slotMinutes: 30 },
    }))

  // Dedicated self-booking publish event (brief 0008 #988): created → published
  // → unpublished. Replay must reconstruct selfBookingPublished from the stream
  // (event-first; the flag is never written outside events).
  it('org — self-booking publish/unpublish (event-first)', async () => {
    const { store, layer } = makeStore()
    const path = 'orgs/t2'
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* appendEvent(OrgConfig, path, {
          _tag: 'org.created',
          actorId: 'owner-2',
          payload: {
            data: {
              id: 't2',
              name: 'Salão',
              slug: 'salao',
              vertical: 'barbershop',
              ownerUserId: 'owner-2',
              fiscalProfile: { stage: 'informal' },
              selfBookingPublished: false,
              selfBookingPublishedAt: null,
              timezone: 'America/Sao_Paulo',
              slotMinutes: 15,
              branding: { logoUrl: null, bannerUrl: null, description: null },
              cancellationPolicy: { enabled: false, minNoticeMinutes: 0 },
              whatsappTemplates: { confirmation: '', reminder: '', cancellation: '' },
              createdAt: '2026-06-01T12:00:00.000Z',
              updatedAt: '2026-06-01T12:00:00.000Z',
            },
          },
        })
        yield* appendEvent(OrgConfig, path, {
          _tag: 'org.self_booking_published',
          actorId: 'owner-2',
          payload: {},
        })
      }).pipe(Effect.provide(layer)),
    )

    const afterPublish = await Effect.runPromise(
      replayAggregate(OrgConfig, path).pipe(Effect.provide(layer)),
    )
    expect(afterPublish).toEqual(store.get(path))
    expect(afterPublish.selfBookingPublished).toBe(true)
    expect(afterPublish.selfBookingPublishedAt).not.toBeNull()
    expect(afterPublish._version).toBe(2)

    // Unpublish reverses the flag (timestamp left as the last publish moment).
    await Effect.runPromise(
      appendEvent(OrgConfig, path, {
        _tag: 'org.self_booking_unpublished',
        actorId: 'owner-2',
        payload: {},
      }).pipe(Effect.provide(layer)),
    )
    const afterUnpublish = await Effect.runPromise(
      replayAggregate(OrgConfig, path).pipe(Effect.provide(layer)),
    )
    expect(afterUnpublish).toEqual(store.get(path))
    expect(afterUnpublish.selfBookingPublished).toBe(false)
    expect(afterUnpublish._version).toBe(3)
  })
})

// Uniform delete policy (brief 0027, AC-06 — frente D1). The archive flag is
// event-first: `archived` carries `archivedAt`, the reducer projects it, and
// `null` restores. Proves the field is never written outside the stream.
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
    const { store, layer } = makeStore()
    const path = `orgs/t1/${tag}s/${id}`
    const archivedAt = '2026-06-01T12:00:00.000Z'

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* appendEvent(config, path, {
          _tag: `${tag}.created`,
          actorId: 'actor-1',
          payload: { data },
        })
        yield* appendEvent(config, path, {
          _tag: `${tag}.archived`,
          actorId: 'actor-1',
          payload: { archivedAt },
        })
      }).pipe(Effect.provide(layer)),
    )

    const afterArchive = await Effect.runPromise(
      replayAggregate(config, path).pipe(Effect.provide(layer)),
    )
    expect(afterArchive).toEqual(store.get(path))
    expect(afterArchive.archivedAt).toBe(archivedAt)
    expect(afterArchive._version).toBe(2)

    // Restore — `archivedAt: null` brings it back to active.
    await Effect.runPromise(
      appendEvent(config, path, {
        _tag: `${tag}.archived`,
        actorId: 'actor-1',
        payload: { archivedAt: null },
      }).pipe(Effect.provide(layer)),
    )
    const afterRestore = await Effect.runPromise(
      replayAggregate(config, path).pipe(Effect.provide(layer)),
    )
    expect(afterRestore).toEqual(store.get(path))
    expect(afterRestore.archivedAt).toBeNull()
    expect(afterRestore._version).toBe(3)
  }

  it('unit', () =>
    checkArchive(UnitConfig, 'unit', 'u1', {
      id: 'u1',
      orgId: 't1',
      name: 'Centro',
      slug: 'centro',
      // address/businessHours/hoursMode REQUIRED in the v2 schema (PRD Identidade).
      address: {
        postalCode: '01310-100',
        state: 'SP',
        city: 'São Paulo',
        neighborhood: 'Bela Vista',
        street: 'Av. Paulista',
        number: '1000',
        complement: null,
      },
      businessHours: {
        monday: { open: '09:00', close: '18:00' },
        tuesday: { open: '09:00', close: '18:00' },
        wednesday: { open: '09:00', close: '18:00' },
        thursday: { open: '09:00', close: '18:00' },
        friday: { open: '09:00', close: '18:00' },
        saturday: null,
        sunday: null,
      },
      hoursMode: 'fixed',
      archivedAt: null,
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
