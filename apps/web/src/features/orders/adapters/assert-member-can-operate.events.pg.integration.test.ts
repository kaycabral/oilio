// The financial attribution gate `assertMemberCanOperate` (brief 0030 AC-05) for
// SERVICE items, proven against REAL Postgres after `operationalStatus` became
// DERIVED on read (#1226 AC-02). The gate must NOT regress: a professional whose
// readiness no longer materializes on a column is still refused a service unless
// the DERIVED status is `operational` (whatsapp present ∧ ≥1 unit ∧ ≥1 service).
//
// The professional is minted through the real write path (`appendEvent`), so the
// projector mirrors `unit_ids`/`catalog_service_ids` into the join tables; the
// linked `users` row carries (or omits) the whatsapp the derive keys on. The gate
// reads the enriched `Professional` via `getProfessionalByUserId`, which derives
// the status — exactly the production read path.

import { defaultPermissionsForRole } from '@/domain'
import { ProfessionalConfig } from '@/domain/aggregates'
import { aggregateRef, appendEvent } from '@/domain/effect'
import type { StoredProfessional } from '@/domain/types/professional'
import { PostgresPersistenceLayer } from '@/shared/db/pg/effect/postgres-layer'
import { closeEventStoreDb, getEventStorePool } from '@/shared/db/pg/pool'
import { putUser } from '@/shared/db/pg/users-store'
import { buildUser } from '@/shared/fixtures/domain-builders'
import { Effect } from 'effect'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { assertMemberCanOperate } from './order-write-helpers'

const TS = '2026-06-01T12:00:00.000Z'

let seq = 0
function uniqueOrg(): string {
  seq += 1
  return `gate-${Date.now()}-${seq}`
}
function id(prefix: string): string {
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

async function seedUnit(orgId: string, unitId: string): Promise<void> {
  await pool().query(
    `INSERT INTO units (org_id, id, last_event_version, name, slug, timezone, agenda_mode, fiscal_kind, address, agenda, fiscal, created_at, updated_at)
     VALUES ($1,$2,1,'Unit','unit-'||$2,'America/Sao_Paulo','always_open','informal','{}'::jsonb,'{}'::jsonb,'{}'::jsonb,$3,$3)
     ON CONFLICT (org_id, id) DO NOTHING`,
    [orgId, unitId, TS],
  )
}

async function seedService(orgId: string, serviceId: string): Promise<void> {
  await pool().query(
    `INSERT INTO catalog_items (org_id, id, last_event_version, kind, name, category_id, price_cents, price_visibility, active, archived_at, duration_minutes, sku, stock, gtin14, reconciliation_pending, reconciliation_last_attempt, commission, unit_ids, unit_overrides, required_resources, public_visible, created_at, updated_at)
     VALUES ($1,$2,1,'service','Service',NULL,5000,'visible',true,NULL,30,NULL,NULL,NULL,NULL,NULL,NULL,'[]'::jsonb,NULL,NULL,false,$3,$3)
     ON CONFLICT (org_id, id) DO NOTHING`,
    [orgId, serviceId, TS],
  )
}

async function seedMembership(orgId: string, userId: string): Promise<void> {
  const membershipId = `${orgId}_${userId}`
  await pool().query(
    `INSERT INTO memberships (org_id, id, user_id, last_event_version, role, status, rls_unit_scope, invited_by, joined_at, permissions, updated_at)
     VALUES ($1,$2,$3,1,'professional','active',NULL,NULL,$4,$5::jsonb,$4)`,
    [orgId, membershipId, userId, TS, JSON.stringify(defaultPermissionsForRole('professional'))],
  )
}

// Mint a professional through the real write path (projector mirrors the join
// tables) + its linked User. `whatsapp` controls the derived readiness.
async function seedProfessional(
  orgId: string,
  opts: { whatsapp: string | null; unitIds: string[]; catalogServiceIds: string[] },
): Promise<string> {
  const userId = id('user')
  for (const u of opts.unitIds) await seedUnit(orgId, u)
  for (const s of opts.catalogServiceIds) await seedService(orgId, s)
  await putUser(
    buildUser(userId, TS, {
      completionCompleted: opts.whatsapp !== null,
      whatsapp: opts.whatsapp ?? undefined,
    }),
  )
  await seedMembership(orgId, userId)
  const proId = id('pro')
  const pro: StoredProfessional = {
    id: proId,
    orgId,
    userId,
    defaultCommission: null,
    unitIds: opts.unitIds,
    catalogServiceIds: opts.catalogServiceIds,
    createdAt: TS,
    updatedAt: TS,
  }
  await Effect.runPromise(
    appendEvent(ProfessionalConfig, aggregateRef(ProfessionalConfig, orgId, proId), {
      _tag: 'professional.created',
      actorId: 'test',
      payload: { data: pro },
    }).pipe(Effect.provide(PostgresPersistenceLayer)),
  )
  return userId
}

const TABLES =
  'events, projections, professional_units, professional_services, professionals, catalog_items, memberships, units, orgs, users'

describe('assertMemberCanOperate — SERVICE gate over DERIVED operationalStatus (#1226 AC-02)', () => {
  beforeEach(async () => {
    await pool().query(`TRUNCATE ${TABLES} CASCADE`)
  })
  afterAll(async () => {
    await closeEventStoreDb()
  })

  const UNIT = 'unit-1'
  const SERVICE = 'svc-1'

  it('complete profile (whatsapp ∧ unit ∧ service) → derives operational → ACCEPTS the service', async () => {
    const orgId = uniqueOrg()
    await seedOrg(orgId)
    const userId = await seedProfessional(orgId, {
      whatsapp: '5511900000000',
      unitIds: [UNIT],
      catalogServiceIds: [SERVICE],
    })
    const err = await assertMemberCanOperate({
      orgId,
      attributedUserId: userId,
      kind: 'service',
      orderUnitId: UNIT,
    })
    expect(err).toBeNull()
  })

  it('NO whatsapp → derives incomplete → REFUSES the service', async () => {
    const orgId = uniqueOrg()
    await seedOrg(orgId)
    const userId = await seedProfessional(orgId, {
      whatsapp: null,
      unitIds: [UNIT],
      catalogServiceIds: [SERVICE],
    })
    const err = await assertMemberCanOperate({
      orgId,
      attributedUserId: userId,
      kind: 'service',
      orderUnitId: UNIT,
    })
    expect(err).not.toBeNull()
    expect(err).toContain('não operacional')
  })

  it('NO unit → derives incomplete → REFUSES the service', async () => {
    const orgId = uniqueOrg()
    await seedOrg(orgId)
    const userId = await seedProfessional(orgId, {
      whatsapp: '5511900000000',
      unitIds: [],
      catalogServiceIds: [SERVICE],
    })
    const err = await assertMemberCanOperate({
      orgId,
      attributedUserId: userId,
      kind: 'service',
      orderUnitId: UNIT,
    })
    expect(err).not.toBeNull()
    expect(err).toContain('não operacional')
  })

  it('NO service → derives incomplete → REFUSES the service', async () => {
    const orgId = uniqueOrg()
    await seedOrg(orgId)
    const userId = await seedProfessional(orgId, {
      whatsapp: '5511900000000',
      unitIds: [UNIT],
      catalogServiceIds: [],
    })
    const err = await assertMemberCanOperate({
      orgId,
      attributedUserId: userId,
      kind: 'service',
      orderUnitId: UNIT,
    })
    expect(err).not.toBeNull()
    expect(err).toContain('não operacional')
  })
})
