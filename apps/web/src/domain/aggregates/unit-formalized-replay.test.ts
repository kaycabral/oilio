// AC-02 (brief 0048) — replay reconstrói a Unidade `company` a partir do stream.
// created (informal) → formalized → replay == projeção: a Unidade transiciona
// informal→company com CNPJ-14 + CompanyProfile + formalizedAt, SEM depender de
// projeção materializada (event-first). Prova de que `unit.formalized` é a
// fronteira fiscal e que o reducer a aplica deterministicamente. A identidade
// fiscal mora na UNIDADE (PRD Identidade v2), não na Org.

import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { docKey, makeReplayStore } from '@/domain/effect/test-layers'
import { aggregateRef } from '../effect/aggregate-ref'
import { appendEvent, replayAggregate } from '../effect/event-store'
import type { CompanyProfile } from '../types/tax'
import { UnitConfig } from './unit/config'

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

function informalUnit() {
  return {
    id: 'unit-1',
    orgId: 'org-1',
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
      mode: 'fixed' as const,
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
    fiscal: { kind: 'informal' as const },
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
  }
}

describe('Unit — unit.formalized replay (brief 0048 AC-02)', () => {
  it('created (informal) → formalized → replay reconstrói fiscal.kind=company', async () => {
    const { store, layer } = makeReplayStore()
    const ref = aggregateRef(UnitConfig, 'org-1', 'unit-1')

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* appendEvent(UnitConfig, ref, {
          _tag: 'unit.created',
          actorId: 'owner-1',
          payload: { data: informalUnit() },
        })
        yield* appendEvent(UnitConfig, ref, {
          _tag: 'unit.formalized',
          actorId: 'owner-1',
          payload: { taxId: CNPJ, companyProfile, formalizedAt: FORMALIZED_AT },
        })
      }).pipe(Effect.provide(layer)),
    )

    const projection = store.get(docKey(ref))!
    const replayed = await Effect.runPromise(
      replayAggregate(UnitConfig, ref).pipe(Effect.provide(layer)),
    )

    // Replay deep-equals the projection (no materialized-state dependency).
    expect(replayed).toEqual(projection)
    expect(replayed._version).toBe(2)
    // The Unit is now company-stage with the full CNPJ-14 + profile + boundary.
    expect(replayed.fiscal.kind).toBe('company')
    if (replayed.fiscal.kind !== 'company') throw new Error('expected company')
    expect(replayed.fiscal.taxId).toBe(CNPJ)
    expect(replayed.fiscal.companyProfile).toEqual(companyProfile)
    expect(replayed.fiscal.formalizedAt).toBe(FORMALIZED_AT)
    // Operational identity is untouched by formalization (zero migration).
    expect(replayed.name).toBe('Centro')
    expect(replayed.slug).toBe('centro')
  })

  it('the event payload carries NO razão social / nome fantasia (ADR 0010)', async () => {
    const { events, layer } = makeReplayStore()
    const ref = aggregateRef(UnitConfig, 'org-1', 'unit-2')

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* appendEvent(UnitConfig, ref, {
          _tag: 'unit.created',
          actorId: 'owner-1',
          payload: { data: { ...informalUnit(), id: 'unit-2' } },
        })
        yield* appendEvent(UnitConfig, ref, {
          _tag: 'unit.formalized',
          actorId: 'owner-1',
          payload: { taxId: CNPJ, companyProfile, formalizedAt: FORMALIZED_AT },
        })
      }).pipe(Effect.provide(layer)),
    )

    const event = events.get(docKey(ref))![1]!
    const serialized = JSON.stringify(event)
    // PII name fields never enter the immutable event (they live in the
    // deletable orgs/{orgId}/units/{unitId}/private/taxIdentity doc).
    expect(serialized).not.toMatch(/legalName|tradeName|raz[aã]o/i)
    expect(event['_tag']).toBe('unit.formalized')
    expect(event['actorId']).toBe('owner-1')
  })
})
