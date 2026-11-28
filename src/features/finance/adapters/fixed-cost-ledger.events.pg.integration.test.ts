import { closeEventStoreDb } from '@/shared/db/pg/pool'
import { ownerPool } from '@/shared/db/pg/test/owner-pool'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { readOrgLedger } from './ledger.repo'

const ORG = 'org-fc-ledger'
const UNIT = 'unit-fc-ledger'

function pool() {
  return ownerPool()
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
     VALUES ($1,$2,1,'Unit','unit-'||$2,'UTC','always_open','informal','{"postalCode":"01310100","state":"SP","city":"São Paulo","neighborhood":"Bela Vista","street":"Avenida Paulista","number":"1000","complement":null}'::jsonb,'{}'::jsonb,'{}'::jsonb,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')
     ON CONFLICT (org_id, id) DO NOTHING`,
    [ORG, UNIT],
  )
}

type FixedCostSeed = {
  id: string
  seriesId: string
  amountCents: number
  effectiveFrom: string
  effectiveTo: string | null
}

async function seedFixedCost(seed: FixedCostSeed): Promise<void> {
  await pool().query(
    `INSERT INTO fixed_costs (org_id, id, unit_id, series_id, last_event_version, name, category, amount_cents, effective_from, effective_to, archived_at, created_at, updated_at)
     VALUES ($1,$2,$3,$4,1,'Aluguel','expense_admin',$5,$6,$7,NULL,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`,
    [ORG, seed.id, UNIT, seed.seriesId, seed.amountCents, seed.effectiveFrom, seed.effectiveTo],
  )
}

async function seedOverride(seriesId: string, month: string, amountCents: number): Promise<void> {
  await pool().query(
    `INSERT INTO fixed_cost_overrides (org_id, id, unit_id, series_id, last_event_version, month, amount_cents, created_at, updated_at)
     VALUES ($1,'ov-'||$3,$2,$4,1,$3,$5,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`,
    [ORG, UNIT, month, seriesId, amountCents],
  )
}

const WINDOW = {
  orgId: ORG,
  fromIso: '2026-01-01T00:00:00.000Z',
  toIso: '2026-04-01T00:00:00.000Z',
}

describe('Razão — fixed-cost production (brief 0092, Grupo B)', () => {
  beforeEach(async () => {
    await pool().query(
      'TRUNCATE fixed_costs, fixed_cost_overrides, units, orgs, events, projections CASCADE',
    )
    await seedParents()
  })

  afterAll(async () => {
    await closeEventStoreDb()
  })

  it('expands one LedgerEntry per competence month of the window (AC-06)', async () => {
    await seedFixedCost({
      id: 'fc-1',
      seriesId: 'series-1',
      amountCents: 200000,
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      effectiveTo: null,
    })

    const ledger = await readOrgLedger(WINDOW)
    const fixed = ledger.filter((e) => e.source === 'manual')

    expect(fixed.map((e) => e.occurredAt).sort()).toEqual([
      '2026-01-01T00:00:00.000Z',
      '2026-02-01T00:00:00.000Z',
      '2026-03-01T00:00:00.000Z',
    ])
    expect(fixed.every((e) => e.nature === 'expense_admin')).toBe(true)
    expect(fixed.every((e) => e.behavior === 'fixed')).toBe(true)
    expect(fixed.every((e) => e.link === 'unit')).toBe(true)
    expect(fixed.every((e) => e.direction === 'out')).toBe(true)
    expect(fixed.every((e) => e.amountCents === 200000)).toBe(true)
  })

  it('gives each entry a deterministic id per (cost, month), stable on re-read (AC-07)', async () => {
    await seedFixedCost({
      id: 'fc-1',
      seriesId: 'series-1',
      amountCents: 200000,
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      effectiveTo: null,
    })

    const first = await readOrgLedger(WINDOW)
    const second = await readOrgLedger(WINDOW)
    const ids = (l: typeof first) =>
      l
        .filter((e) => e.source === 'manual')
        .map((e) => e.id)
        .sort()

    expect(ids(first)).toEqual([
      'manual:series-1:2026-01',
      'manual:series-1:2026-02',
      'manual:series-1:2026-03',
    ])
    expect(ids(second)).toEqual(ids(first))
  })

  it('editing the value does not retroact — closed slice keeps its months (AC-08)', async () => {
    await seedFixedCost({
      id: 'fc-old',
      seriesId: 'series-1',
      amountCents: 200000,
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      effectiveTo: '2026-03-01T00:00:00.000Z',
    })
    await seedFixedCost({
      id: 'fc-new',
      seriesId: 'series-1',
      amountCents: 230000,
      effectiveFrom: '2026-03-01T00:00:00.000Z',
      effectiveTo: null,
    })

    const ledger = await readOrgLedger(WINDOW)
    const byMonth = Object.fromEntries(
      ledger
        .filter((e) => e.source === 'manual')
        .map((e) => [e.occurredAt.slice(0, 7), e.amountCents]),
    )
    expect(byMonth).toEqual({
      '2026-01': 200000,
      '2026-02': 200000,
      '2026-03': 230000,
    })
  })

  it('a single-month override applies only to its month (AC-03)', async () => {
    await seedFixedCost({
      id: 'fc-1',
      seriesId: 'series-1',
      amountCents: 200000,
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      effectiveTo: null,
    })
    await seedOverride('series-1', '2026-02', 250000)

    const ledger = await readOrgLedger(WINDOW)
    const byMonth = Object.fromEntries(
      ledger
        .filter((e) => e.source === 'manual')
        .map((e) => [e.occurredAt.slice(0, 7), e.amountCents]),
    )
    expect(byMonth).toEqual({
      '2026-01': 200000,
      '2026-02': 250000,
      '2026-03': 200000,
    })
  })

  it('an archived cost stops producing entries', async () => {
    await pool().query(
      `INSERT INTO fixed_costs (org_id, id, unit_id, series_id, last_event_version, name, category, amount_cents, effective_from, effective_to, archived_at, created_at, updated_at)
       VALUES ($1,'fc-arch',$2,'series-arch',1,'Antigo','expense_admin',200000,'2026-01-01T00:00:00Z',NULL,'2026-01-15T00:00:00Z','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`,
      [ORG, UNIT],
    )

    const ledger = await readOrgLedger(WINDOW)
    expect(ledger.filter((e) => e.source === 'manual')).toHaveLength(0)
  })
})
