// AC-09/AC-10 (brief 0025) — replay reconstrói o doc completo dos cadastros.
// Para cada aggregate de cadastro: created (snapshot) → updated (changes) →
// replayAggregate == projeção, campo a campo. Prova que nenhum campo é escrito
// fora de eventos (event-first).

import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { docKey, makeReplayStore } from '@/domain/effect/test-layers'
import { aggregateRef } from '../effect/aggregate-ref'
import { appendEvent, replayAggregate, type AggregateConfig } from '../effect/event-store'
import { CatalogItemConfig } from './catalog-item/config'
import { CategoryConfig } from './category/config'
import { CustomerConfig } from './customer/config'
import { InviteConfig } from './invite/config'
import { OrgConfig } from './org/config'
import { ProfessionalConfig } from './professional/config'
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
        // address/timezone/agenda are REQUIRED in the v2 schema (PRD Identidade)
        // — the `unit.created` payload carries a real establishment address,
        // timezone and agenda union, not the null/absent state of the v1
        // auto-matriz.
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
        // A unit is born informal — the CNPJ (Unit.fiscal company variant) only
        // appears via `unit.formalized` (brief 0048). NON-PII, so it rides in
        // the projection + event payload.
        fiscal: { kind: 'informal' },
        createdAt: '2026-06-01T12:00:00.000Z',
        updatedAt: '2026-06-01T12:00:00.000Z',
      },
      changes: { name: 'Centro Novo', slug: 'centro-novo' },
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
    // The Org is a pure folder (PRD Identidade v2) — NO fiscal identity (moved
    // to Unit.fiscal). `name` is the business name (not PII) and stays. The
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
        branding: { logoUrl: null, bannerUrl: null, description: null },
        createdAt: '2026-06-01T12:00:00.000Z',
        updatedAt: '2026-06-01T12:00:00.000Z',
      },
      changes: { name: 'Barbearia do Zé' },
    }))

  // Dedicated self-booking publish event (brief 0008 #988), now PER-UNIT (PRD
  // Identidade v2, context 3 — moved Org→Unit): an appointment unit goes
  // created → published → unpublished. Replay must reconstruct
  // `agenda.selfBookingPublished` from the stream (event-first; the flag is
  // never written outside events) and the publish state lives ONLY in the
  // appointment variant of the agenda union.
  it('unit — self-booking publish/unpublish (event-first, per-unit)', async () => {
    const { store, layer } = makeReplayStore()
    const ref = aggregateRef(UnitConfig, 't2', 'u2')
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
              agenda: {
                mode: 'appointment',
                businessHours: {
                  monday: { open: '09:00', close: '18:00' },
                  tuesday: null,
                  wednesday: null,
                  thursday: null,
                  friday: null,
                  saturday: null,
                  sunday: null,
                },
                slotMinutes: 15,
                cancellationPolicy: { enabled: false, minNoticeMinutes: 0 },
                confirmationTemplates: { confirmation: '', reminder: '', cancellation: '' },
                selfBookingPublished: false,
              },
              archivedAt: null,
              fiscal: { kind: 'informal' },
              createdAt: '2026-06-01T12:00:00.000Z',
              updatedAt: '2026-06-01T12:00:00.000Z',
            },
          },
        })
        yield* appendEvent(UnitConfig, ref, {
          _tag: 'unit.self_booking_published',
          actorId: 'owner-2',
          payload: {},
        })
      }).pipe(Effect.provide(layer)),
    )

    const afterPublish = await Effect.runPromise(
      replayAggregate(UnitConfig, ref).pipe(Effect.provide(layer)),
    )
    expect(afterPublish).toEqual(store.get(docKey(ref)))
    // The publish state lives in the appointment variant of the agenda union.
    expect(afterPublish.agenda.mode).toBe('appointment')
    if (afterPublish.agenda.mode !== 'appointment') throw new Error('expected appointment')
    expect(afterPublish.agenda.selfBookingPublished).toBe(true)
    expect(afterPublish.agenda.selfBookingPublishedAt).not.toBeNull()
    expect(afterPublish._version).toBe(2)

    // Unpublish reverses the flag (timestamp left as the last publish moment).
    await Effect.runPromise(
      appendEvent(UnitConfig, ref, {
        _tag: 'unit.self_booking_unpublished',
        actorId: 'owner-2',
        payload: {},
      }).pipe(Effect.provide(layer)),
    )
    const afterUnpublish = await Effect.runPromise(
      replayAggregate(UnitConfig, ref).pipe(Effect.provide(layer)),
    )
    expect(afterUnpublish).toEqual(store.get(docKey(ref)))
    if (afterUnpublish.agenda.mode !== 'appointment') throw new Error('expected appointment')
    expect(afterUnpublish.agenda.selfBookingPublished).toBe(false)
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

    // Restore — `archivedAt: null` brings it back to active.
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
      // address/timezone/agenda REQUIRED in the v2 schema (PRD Identidade).
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
