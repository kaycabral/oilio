import { ProfessionalConfig } from '@/domain/aggregates'
import { aggregateRef, appendEvent } from '@/domain/effect'
import type { StoredProfessional } from '@/domain/types/professional'
import { PostgresPersistenceLayer } from '@/shared/db/pg/effect/postgres-layer'
import { closeEventStoreDb, getEventStorePool } from '@/shared/db/pg/pool'
import { putUser } from '@/shared/db/pg/users-store'
import { buildUser } from '@/shared/fixtures/domain-builders'
import { Effect } from 'effect'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import {
  hasOperationalProfessionalInUnit,
  listProfessionalIdsForService,
  listProfessionalsForServiceInUnit,
} from './professional-read'

/**
 * Inverse-query readers backed by the `professional_units` / `professional_services`
 * join tables (brief 0068 D3, AC-02) against REAL Postgres. Each reader replaces a
 * fetch-all + JS filter at a production call-site:
 *   - `hasOperationalProfessionalInUnit` — units publish-readiness ("operational
 *     pro at this unit?").
 *   - `listProfessionalIdsForService` — catalog `setServiceProfessionals` toggle
 *     diff ("who already performs service Y?").
 *   - `listProfessionalsForServiceInUnit` — public availability ("operational pros
 *     who perform service Y at unit X").
 *
 * The join rows are written by the professional projector in the same tx as the
 * event (proven in `professional-join-projection.*`), so the professionals here are
 * created through `appendEvent` — exercising the real write path the readers read.
 * Readers run under `readUnderRls` over the event-store pool. Per-run-unique org ids
 * isolate each case.
 */

const TS = '2026-06-01T12:00:00.000Z'

let seq = 0
function uniqueOrg(): string {
  seq += 1
  return `prjoin-${Date.now()}-${seq}`
}
function uid(prefix: string): string {
  seq += 1
  return `${prefix}-${Date.now()}-${seq}`
}

function pool() {
  return getEventStorePool()
}

async function seedOrg(orgId: string): Promise<void> {
  await pool().query(
    `INSERT INTO orgs (org_id, id, last_event_version, name, slug, vertical, owner_user_id, branding, created_at, updated_at)
     VALUES ($1,$1,1,'Org','slug-'||$1,'barbershop','owner','{}'::jsonb,$2,$2)
     ON CONFLICT (org_id) DO NOTHING`,
    [orgId, TS],
  )
}

async function seedUnit(orgId: string, id: string): Promise<void> {
  await pool().query(
    `INSERT INTO units (org_id, id, last_event_version, name, slug, timezone, agenda_mode, fiscal_kind, address, agenda, fiscal, created_at, updated_at)
     VALUES ($1,$2,1,'Unit','unit-'||$2,'America/Sao_Paulo','always_open','informal','{}'::jsonb,'{}'::jsonb,'{}'::jsonb,$3,$3)
     ON CONFLICT (org_id, id) DO NOTHING`,
    [orgId, id, TS],
  )
}

async function seedService(orgId: string, id: string): Promise<void> {
  await pool().query(
    `INSERT INTO catalog_items (org_id, id, last_event_version, kind, name, category_id, price_cents, price_visibility, active, archived_at, duration_minutes, sku, stock, gtin14, reconciliation_pending, reconciliation_last_attempt, commission, unit_ids, unit_overrides, required_resources, public_visible, created_at, updated_at)
     VALUES ($1,$2,1,'service','Service',NULL,5000,'visible',true,NULL,30,NULL,NULL,NULL,NULL,NULL,NULL,'[]'::jsonb,NULL,NULL,false,$3,$3)
     ON CONFLICT (org_id, id) DO NOTHING`,
    [orgId, id, TS],
  )
}

// Mint a professional through the real write path so the projector mirrors its
// `unit_ids`/`catalog_service_ids` arrays into the join tables. Parent unit/service
// rows are seeded first (the join FKs are RESTRICT). Returns the professional id.
//
// `operationalStatus` is now DERIVED on read (#1226 AC-02) from the linked
// User's whatsapp + the projection's units/services, so this helper seeds the
// linked `users/{userId}` row accordingly: `operational` ⇒ a completed user WITH
// whatsapp; `incomplete` ⇒ a user WITHOUT whatsapp (the readers enrich from this
// global row and derive the status). The units/services still come from `opts`.
async function seedProfessional(
  orgId: string,
  opts: {
    unitIds?: string[]
    catalogServiceIds?: string[]
    operationalStatus?: 'operational' | 'incomplete'
  } = {},
): Promise<string> {
  await seedOrg(orgId)
  const unitIds = opts.unitIds ?? []
  const catalogServiceIds = opts.catalogServiceIds ?? []
  for (const u of unitIds) await seedUnit(orgId, u)
  for (const s of catalogServiceIds) await seedService(orgId, s)
  const id = uid('pro')
  const userId = uid('user')
  // Seed the linked global user — the read layer derives `operationalStatus`
  // from its whatsapp. `incomplete` ⇒ no whatsapp; otherwise a completed user.
  const wantsOperational = (opts.operationalStatus ?? 'operational') !== 'incomplete'
  await putUser(
    wantsOperational ? buildUser(userId, TS, { completionCompleted: true }) : buildUser(userId, TS),
  )
  // The operational profile hangs off the membership (brief 0076 AC-02): seed
  // the parent membership so the projector's composite FK is satisfiable. The
  // projector derives `member_id` as `{orgId}_{userId}`.
  await getEventStorePool().query(
    `INSERT INTO memberships (org_id, id, user_id, last_event_version, role, status, joined_at, permissions, updated_at)
     VALUES ($1,$1||'_'||$2,$2,1,'professional','active',$3,'{}'::jsonb,$3)
     ON CONFLICT (org_id, id) DO NOTHING`,
    [orgId, userId, TS],
  )
  const pro: StoredProfessional = {
    id,
    orgId,
    userId,
    defaultCommission: null,
    unitIds,
    catalogServiceIds,
    createdAt: TS,
    updatedAt: TS,
  }
  await Effect.runPromise(
    appendEvent(ProfessionalConfig, aggregateRef(ProfessionalConfig, orgId, id), {
      _tag: 'professional.created',
      actorId: 'test',
      payload: { data: pro },
    }).pipe(Effect.provide(PostgresPersistenceLayer)),
  )
  return id
}

const TABLES =
  'events, projections, professional_units, professional_services, professionals, memberships, catalog_items, units, orgs, users'

describe('professional inverse-query readers (brief 0068 D3, AC-02)', () => {
  beforeEach(async () => {
    await pool().query(`TRUNCATE ${TABLES} CASCADE`)
  })
  afterAll(async () => {
    await closeEventStoreDb()
  })

  describe('hasOperationalProfessionalInUnit', () => {
    it('no professional at the unit → false', async () => {
      const t = uniqueOrg()
      expect(await hasOperationalProfessionalInUnit(t, uid('unit'))).toBe(false)
    })

    it('operational professional scoped to the unit → true', async () => {
      const t = uniqueOrg()
      const unitId = uid('unit')
      // Operational requires whatsapp ∧ ≥1 unit ∧ ≥1 service (#1226 AC-02).
      await seedProfessional(t, { unitIds: [unitId], catalogServiceIds: [uid('svc')] })
      expect(await hasOperationalProfessionalInUnit(t, unitId)).toBe(true)
    })

    it('only a NON-operational professional at the unit → false', async () => {
      const t = uniqueOrg()
      const unitId = uid('unit')
      await seedProfessional(t, { unitIds: [unitId], operationalStatus: 'incomplete' })
      expect(await hasOperationalProfessionalInUnit(t, unitId)).toBe(false)
    })

    it('professional at a DIFFERENT unit → false for the queried unit', async () => {
      const t = uniqueOrg()
      const queried = uid('unit')
      await seedProfessional(t, { unitIds: [uid('other-unit')] })
      expect(await hasOperationalProfessionalInUnit(t, queried)).toBe(false)
    })
  })

  describe('listProfessionalIdsForService', () => {
    it('no link → empty', async () => {
      const t = uniqueOrg()
      expect(await listProfessionalIdsForService(t, uid('svc'))).toEqual([])
    })

    it('returns exactly the professionals linked to the service', async () => {
      const t = uniqueOrg()
      const svc = uid('svc')
      const a = await seedProfessional(t, { unitIds: [uid('u')], catalogServiceIds: [svc] })
      const b = await seedProfessional(t, { unitIds: [uid('u')], catalogServiceIds: [svc] })
      await seedProfessional(t, { unitIds: [uid('u')], catalogServiceIds: [uid('other-svc')] })
      const ids = await listProfessionalIdsForService(t, svc)
      expect(new Set(ids)).toEqual(new Set([a, b]))
    })
  })

  describe('listProfessionalsForServiceInUnit', () => {
    it('returns only operational pros performing the service at the unit (intersection)', async () => {
      const t = uniqueOrg()
      const unitId = uid('unit')
      const svc = uid('svc')
      // Match: service + unit, operational.
      const match = await seedProfessional(t, { unitIds: [unitId], catalogServiceIds: [svc] })
      // Wrong unit.
      await seedProfessional(t, { unitIds: [uid('other-unit')], catalogServiceIds: [svc] })
      // Wrong service.
      await seedProfessional(t, { unitIds: [unitId], catalogServiceIds: [uid('other-svc')] })
      // Right unit+service but not operational.
      await seedProfessional(t, {
        unitIds: [unitId],
        catalogServiceIds: [svc],
        operationalStatus: 'incomplete',
      })
      const pros = await listProfessionalsForServiceInUnit(t, svc, unitId)
      expect(pros.map((p) => p.id)).toEqual([match])
    })

    it('no match → empty', async () => {
      const t = uniqueOrg()
      expect(await listProfessionalsForServiceInUnit(t, uid('svc'), uid('unit'))).toEqual([])
    })
  })
})
