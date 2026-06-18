// AC-02 (brief 0048) — replay reconstrói a Org `company` a partir do stream.
// created (informal) → formalized → replay == projeção: a Org transiciona
// informal→company com raiz/CNPJ + CompanyProfile + formalizedAt, SEM depender
// de projeção materializada (event-first). Prova de que `org.formalized` é a
// fronteira fiscal e que o reducer a aplica deterministicamente.

import { Effect, Layer } from 'effect'
import { describe, expect, it } from 'vitest'

import { appendEvent, replayAggregate } from '../effect/event-store'
import type { FirestoreDoc } from '../effect/services'
import { FirestoreService } from '../effect/services'
import type { CompanyProfile } from '../types/tax'
import { OrgConfig } from './org/config'

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

const CNPJ = '40148980000199'
const FORMALIZED_AT = '2026-06-18T12:00:00.000Z'

const companyProfile: CompanyProfile = {
  taxId: CNPJ,
  isMei: false,
  taxRegime: 'simples_nacional',
  primaryActivity: { code: '6201501', description: 'Desenvolvimento de software' },
  secondaryActivities: [],
  companySize: 'micro',
  legalNature: 'Sociedade Empresária Limitada',
  registrationStatus: 'ATIVA',
  shareCapital: 1000,
  activityStartedAt: '2020-12-17',
}

function informalOrg() {
  return {
    id: 'org-1',
    name: 'Estúdio do João',
    slug: 'estudio-do-joao',
    vertical: 'barbershop' as const,
    ownerUserId: 'owner-1',
    fiscalProfile: { stage: 'informal' as const },
    selfBookingPublished: false,
    selfBookingPublishedAt: null,
    timezone: 'America/Sao_Paulo',
    slotMinutes: 15 as const,
    branding: { logoUrl: null, bannerUrl: null, description: null },
    cancellationPolicy: { enabled: false, minNoticeMinutes: 120 },
    whatsappTemplates: { confirmation: '', reminder: '', cancellation: '' },
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
  }
}

describe('Org — org.formalized replay (brief 0048 AC-02)', () => {
  it('created (informal) → formalized → replay reconstrói stage=company', async () => {
    const { store, layer } = makeStore()
    const path = 'orgs/org-1'

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* appendEvent(OrgConfig, path, {
          _tag: 'org.created',
          actorId: 'owner-1',
          payload: { data: informalOrg() },
        })
        yield* appendEvent(OrgConfig, path, {
          _tag: 'org.formalized',
          actorId: 'owner-1',
          payload: { taxId: CNPJ, companyProfile, formalizedAt: FORMALIZED_AT },
        })
      }).pipe(Effect.provide(layer)),
    )

    const projection = store.get(path)!
    const replayed = await Effect.runPromise(
      replayAggregate(OrgConfig, path).pipe(Effect.provide(layer)),
    )

    // Replay deep-equals the projection (no materialized-state dependency).
    expect(replayed).toEqual(projection)
    expect(replayed._version).toBe(2)
    // The Org is now company-stage with the full CNPJ-14 + profile + boundary.
    expect(replayed.fiscalProfile.stage).toBe('company')
    if (replayed.fiscalProfile.stage !== 'company') throw new Error('expected company')
    expect(replayed.fiscalProfile.taxId).toBe(CNPJ)
    expect(replayed.fiscalProfile.companyProfile).toEqual(companyProfile)
    expect(replayed.fiscalProfile.formalizedAt).toBe(FORMALIZED_AT)
    // Operational identity is untouched by formalization (zero migration).
    expect(replayed.name).toBe('Estúdio do João')
    expect(replayed.slug).toBe('estudio-do-joao')
  })

  it('the event payload carries NO razão social / nome fantasia (ADR 0010)', async () => {
    const { store, layer } = makeStore()
    const path = 'orgs/org-2'

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* appendEvent(OrgConfig, path, {
          _tag: 'org.created',
          actorId: 'owner-1',
          payload: { data: { ...informalOrg(), id: 'org-2' } },
        })
        yield* appendEvent(OrgConfig, path, {
          _tag: 'org.formalized',
          actorId: 'owner-1',
          payload: { taxId: CNPJ, companyProfile, formalizedAt: FORMALIZED_AT },
        })
      }).pipe(Effect.provide(layer)),
    )

    const event = store.get(`${path}/events/v000002`)!
    const serialized = JSON.stringify(event)
    // PII name fields never enter the immutable event (they live in the
    // deletable orgs/{id}/private/taxIdentity doc).
    expect(serialized).not.toMatch(/legalName|tradeName|raz[aã]o/i)
    expect(event['_tag']).toBe('org.formalized')
    expect(event['actorId']).toBe('owner-1')
  })
})
