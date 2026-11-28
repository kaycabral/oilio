import {
  cnpjRaiz,
  DEFAULT_UNIT_FISCAL,
  EMPTY_AGENDA_CONFIG,
  isMatrizCnpj,
  type CompanyProfile,
  type StoredUnit,
} from '@/domain'
import { UnitConfig } from '@/domain/aggregates'
import { aggregateRef, appendEvent, replayAggregate } from '@/domain/effect'
import { PostgresPersistenceLayer } from '@/shared/db/pg/effect/postgres-layer'
import { closeEventStoreDb } from '@/shared/db/pg/pool'
import { ownerPool } from '@/shared/db/pg/test/owner-pool'
import { getUnitTaxIdentity, writeUnitTaxIdentity } from '@/shared/org/unit-read'
import { Effect } from 'effect'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

const ORG = 'org-formalize'
const UNIT = 'unit-1'
const CNPJ = '40148980000199'
const unitRef = aggregateRef(UnitConfig, ORG, UNIT)

const profile: CompanyProfile = {
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

const run = <A, E>(eff: Effect.Effect<A, E, never>) => Effect.runPromise(eff)

async function seedOrg(): Promise<void> {
  await ownerPool().query(
    `INSERT INTO orgs (org_id, id, last_event_version, name, slug, vertical, owner_user_id, branding, created_at, updated_at)
     VALUES ($1,$1,1,'Org','slug','barbershop','owner','{}'::jsonb,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`,
    [ORG],
  )
}

function informalUnit(): StoredUnit {
  return {
    id: UNIT,
    orgId: ORG,
    name: 'Centro',
    slug: 'centro',
    address: {
      postalCode: '01310100',
      state: 'SP',
      city: 'São Paulo',
      neighborhood: 'Bela Vista',
      street: 'Avenida Paulista',
      number: '1000',
      complement: null,
    },
    timezone: 'America/Sao_Paulo',
    agenda: EMPTY_AGENDA_CONFIG,
    archivedAt: null,
    fiscal: DEFAULT_UNIT_FISCAL,
    createdAt: '2026-06-01T12:00:00.000Z',
    updatedAt: '2026-06-01T12:00:00.000Z',
  }
}

async function createInformalUnit(): Promise<void> {
  await run(
    appendEvent(UnitConfig, unitRef, {
      _tag: 'unit.created',
      actorId: 'owner',
      payload: { data: informalUnit() },
    }).pipe(Effect.provide(PostgresPersistenceLayer)),
  )
}

async function formalize(): Promise<{ ok: true } | { ok: false; error: string }> {
  const formalizedAt = new Date().toISOString()
  const emitted = await Effect.runPromise(
    appendEvent(UnitConfig, unitRef, {
      _tag: 'unit.formalized',
      actorId: 'owner',
      payload: { taxId: CNPJ, companyProfile: profile, formalizedAt },
    }).pipe(
      Effect.map(() => ({ ok: true as const })),
      Effect.catchTag('EventValidationError', (e) =>
        Effect.succeed({ ok: false as const, error: e.message }),
      ),
      Effect.provide(PostgresPersistenceLayer),
    ),
  )
  if (!emitted.ok) return emitted
  await writeUnitTaxIdentity(ORG, UNIT, {
    kind: 'company',
    taxId: CNPJ,
    legalName: 'CABRAL TECNOLOGIA LTDA',
    tradeName: 'CABRAL TECH',
  })
  return { ok: true }
}

describe('formalizeUnit — Postgres (brief 0048 / 0062 cutover)', () => {
  beforeEach(async () => {
    await ownerPool().query(
      'TRUNCATE events, projections, units, unit_tax_identity, orgs CASCADE',
    )
    await seedOrg()
    await createInformalUnit()
  })

  afterAll(async () => {
    await closeEventStoreDb()
  })

  it('informal → unit.formalized → company: replay + typed projection + PII sidecar, raiz derivable', async () => {
    const res = await formalize()
    expect(res).toEqual({ ok: true })

    const replayed = await run(
      replayAggregate(UnitConfig, unitRef).pipe(Effect.provide(PostgresPersistenceLayer)),
    )
    expect(replayed.fiscal.kind).toBe('company')
    if (replayed.fiscal.kind !== 'company') throw new Error('expected company')
    expect(replayed.fiscal.taxId).toBe(CNPJ)
    expect(replayed.fiscal.companyProfile.taxRegime).toBe('simples_nacional')
    expect(replayed.fiscal.formalizedAt).toBeTruthy()
    expect(isMatrizCnpj(replayed.fiscal.taxId)).toBe(true)
    expect(cnpjRaiz(replayed.fiscal.taxId)).toBe('40148980')

    const row = await ownerPool().query<{ fiscal_kind: string; fiscal: { kind: string } }>(
      'SELECT fiscal_kind, fiscal FROM units WHERE org_id = $1 AND id = $2',
      [ORG, UNIT],
    )
    expect(row.rows[0]?.fiscal_kind).toBe('company')
    expect(row.rows[0]?.fiscal.kind).toBe('company')

    const taxIdentity = await getUnitTaxIdentity(ORG, UNIT)
    expect(taxIdentity?.kind).toBe('company')
    if (taxIdentity?.kind !== 'company') throw new Error('expected company taxIdentity')
    expect(taxIdentity.legalName).toBe('CABRAL TECNOLOGIA LTDA')
    expect(taxIdentity.tradeName).toBe('CABRAL TECH')
  })

  it('the unit.formalized event carries NO razão social / nome fantasia (ADR 0010)', async () => {
    await formalize()
    const events = await ownerPool().query<{ envelope: unknown }>(
      `SELECT envelope FROM events WHERE aggregate_id = $1 AND org_id = $2 AND envelope->>'_tag' = 'unit.formalized'`,
      [UNIT, ORG],
    )
    expect(events.rows).toHaveLength(1)
    expect(JSON.stringify(events.rows[0]?.envelope)).not.toMatch(
      /CABRAL TECNOLOGIA LTDA|CABRAL TECH/,
    )
  })

  it('idempotency: an already-company unit is guarded out before re-emitting', async () => {
    const first = await formalize()
    expect(first.ok).toBe(true)

    const current = await run(
      replayAggregate(UnitConfig, unitRef).pipe(Effect.provide(PostgresPersistenceLayer)),
    )
    expect(current.fiscal.kind).toBe('company')
    const beforeCount = await ownerPool().query<{ n: number }>(
      'SELECT count(*)::int AS n FROM events WHERE aggregate_id = $1 AND org_id = $2',
      [UNIT, ORG],
    )
    expect(beforeCount.rows[0]?.n).toBe(2)
  })
})
