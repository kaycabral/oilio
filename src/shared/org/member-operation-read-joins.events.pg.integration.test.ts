import { MemberOperationConfig } from '@/domain/aggregates'
import { aggregateRef, appendEvent } from '@/domain/effect'
import type { StoredMemberOperation } from '@/domain/types/member-operation'
import { PostgresPersistenceLayer } from '@/shared/db/pg/effect/postgres-layer'
import { closeEventStoreDb, getEventStorePool } from '@/shared/db/pg/pool'
import { putUser } from '@/shared/db/pg/users-store'
import { buildUser } from '@/shared/fixtures/domain-builders'
import { Effect } from 'effect'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import {
  hasOperationalMemberOperationInUnit,
  listMemberOperationIdsForService,
  listMemberOperationsForServiceInUnit,
} from './member-operation-read'

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
     VALUES ($1,$2,1,'Unit','unit-'||$2,'America/Sao_Paulo','always_open','informal','{"postalCode":"01310100","state":"SP","city":"São Paulo","neighborhood":"Bela Vista","street":"Avenida Paulista","number":"1000","complement":null}'::jsonb,'{}'::jsonb,'{}'::jsonb,$3,$3)
     ON CONFLICT (org_id, id) DO NOTHING`,
    [orgId, id, TS],
  )
}

async function seedService(orgId: string, id: string): Promise<void> {
  await pool().query(
    `INSERT INTO catalog_items (org_id, id, last_event_version, kind, name, category_id, price_cents, price_visibility, active, archived_at, duration_minutes, sku, stock, gtin14, reconciliation_pending, reconciliation_last_attempt, commission, unit_ids, unit_overrides, required_resources, public_visible, created_at, updated_at)
     VALUES ($1,$2,1,'service','Service',NULL,5000,'visible',true,NULL,30,NULL,NULL,NULL,NULL,NULL,NULL,'["unit-seed"]'::jsonb,NULL,NULL,false,$3,$3)
     ON CONFLICT (org_id, id) DO NOTHING`,
    [orgId, id, TS],
  )
}

// global row and derive the status). The units/services still come from `opts`.
async function seedMemberOperation(
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
  const wantsOperational = (opts.operationalStatus ?? 'operational') !== 'incomplete'
  await putUser(
    wantsOperational ? buildUser(userId, TS, { completionCompleted: true }) : buildUser(userId, TS),
  )
  await getEventStorePool().query(
    `INSERT INTO memberships (org_id, id, user_id, last_event_version, role, status, joined_at, permissions, updated_at)
     VALUES ($1,$1||'_'||$2,$2,1,'member_operator','active',$3,'{}'::jsonb,$3)
     ON CONFLICT (org_id, id) DO NOTHING`,
    [orgId, userId, TS],
  )
  const pro: StoredMemberOperation = {
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
    appendEvent(MemberOperationConfig, aggregateRef(MemberOperationConfig, orgId, id), {
      _tag: 'member_operation.created',
      actorId: 'test',
      payload: { data: pro },
    }).pipe(Effect.provide(PostgresPersistenceLayer)),
  )
  return id
}

const TABLES =
  'events, projections, member_operation_units, member_operation_services, member_operations, memberships, catalog_items, units, orgs, users'

describe('memberOperation inverse-query readers (brief 0068 D3, AC-02)', () => {
  beforeEach(async () => {
    await pool().query(`TRUNCATE ${TABLES} CASCADE`)
  })
  afterAll(async () => {
    await closeEventStoreDb()
  })

  describe('hasOperationalMemberOperationInUnit', () => {
    it('no memberOperation at the unit → false', async () => {
      const t = uniqueOrg()
      expect(await hasOperationalMemberOperationInUnit(t, uid('unit'))).toBe(false)
    })

    it('operational memberOperation scoped to the unit → true', async () => {
      const t = uniqueOrg()
      const unitId = uid('unit')
      await seedMemberOperation(t, { unitIds: [unitId], catalogServiceIds: [uid('svc')] })
      expect(await hasOperationalMemberOperationInUnit(t, unitId)).toBe(true)
    })

    it('only a NON-operational memberOperation at the unit → false', async () => {
      const t = uniqueOrg()
      const unitId = uid('unit')
      await seedMemberOperation(t, { unitIds: [unitId], operationalStatus: 'incomplete' })
      expect(await hasOperationalMemberOperationInUnit(t, unitId)).toBe(false)
    })

    it('memberOperation at a DIFFERENT unit → false for the queried unit', async () => {
      const t = uniqueOrg()
      const queried = uid('unit')
      await seedMemberOperation(t, { unitIds: [uid('other-unit')] })
      expect(await hasOperationalMemberOperationInUnit(t, queried)).toBe(false)
    })
  })

  describe('listMemberOperationIdsForService', () => {
    it('no link → empty', async () => {
      const t = uniqueOrg()
      expect(await listMemberOperationIdsForService(t, uid('svc'))).toEqual([])
    })

    it('returns exactly the memberOperations linked to the service', async () => {
      const t = uniqueOrg()
      const svc = uid('svc')
      const a = await seedMemberOperation(t, { unitIds: [uid('u')], catalogServiceIds: [svc] })
      const b = await seedMemberOperation(t, { unitIds: [uid('u')], catalogServiceIds: [svc] })
      await seedMemberOperation(t, { unitIds: [uid('u')], catalogServiceIds: [uid('other-svc')] })
      const ids = await listMemberOperationIdsForService(t, svc)
      expect(new Set(ids)).toEqual(new Set([a, b]))
    })
  })

  describe('listMemberOperationsForServiceInUnit', () => {
    it('returns only operational pros performing the service at the unit (intersection)', async () => {
      const t = uniqueOrg()
      const unitId = uid('unit')
      const svc = uid('svc')
      const match = await seedMemberOperation(t, { unitIds: [unitId], catalogServiceIds: [svc] })
      await seedMemberOperation(t, { unitIds: [uid('other-unit')], catalogServiceIds: [svc] })
      await seedMemberOperation(t, { unitIds: [unitId], catalogServiceIds: [uid('other-svc')] })
      await seedMemberOperation(t, {
        unitIds: [unitId],
        catalogServiceIds: [svc],
        operationalStatus: 'incomplete',
      })
      const pros = await listMemberOperationsForServiceInUnit(t, svc, unitId)
      expect(pros.map((p) => p.id)).toEqual([match])
    })

    it('no match → empty', async () => {
      const t = uniqueOrg()
      expect(await listMemberOperationsForServiceInUnit(t, uid('svc'), uid('unit'))).toEqual([])
    })
  })
})
