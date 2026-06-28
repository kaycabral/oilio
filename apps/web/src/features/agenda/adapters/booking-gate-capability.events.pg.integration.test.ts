// The booking write gate `loadApprovedProfessional` must enforce the SAME
// invariant the agenda read filters on (brief 0076 AC-03): a member is bookable
// iff the membership carries `canBeBooked` ∧ the profile is operational. After
// the `BookableProfessional` brand was retired, "bookable" is the capability —
// so the write path (createAppointment/updateAppointment) must refuse a member
// whose `canBeBooked` was toggled off, even though they are still operational and
// still hidden from the grid. This proves the read and write can't drift (a stale
// form / deep link can't book a soft-disabled member).
//
// The professional is minted through the real write path; the gate reads the
// enriched `Professional` + the membership capability exactly like production.

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
import { loadApprovedProfessional } from './appointment-write-helpers'

const TS = '2026-06-01T12:00:00.000Z'

let seq = 0
function uniqueOrg(): string {
  seq += 1
  return `bookgate-${Date.now()}-${seq}`
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

// Seed a membership for `userId` with `canBeBooked` either on (the professional
// preset) or forced off. Seeded BEFORE the professional (composite FK parent).
async function seedMembership(orgId: string, userId: string, canBeBooked: boolean): Promise<void> {
  const permissions = { ...defaultPermissionsForRole('professional'), canBeBooked }
  await pool().query(
    `INSERT INTO memberships (org_id, id, user_id, last_event_version, role, status, rls_unit_scope, invited_by, joined_at, permissions, updated_at)
     VALUES ($1,$2,$3,1,'professional','active',NULL,NULL,$4,$5::jsonb,$4)`,
    [orgId, `${orgId}_${userId}`, userId, TS, JSON.stringify(permissions)],
  )
}

// Mint an OPERATIONAL professional (whatsapp ∧ ≥1 unit ∧ ≥1 service) through the
// real write path; `canBeBooked` is the only axis the tests vary. Returns the
// professional id (what the booking gate is keyed on).
async function seedOperationalProfessional(
  orgId: string,
  unitId: string,
  serviceId: string,
  canBeBooked: boolean,
): Promise<string> {
  const userId = id('user')
  await seedUnit(orgId, unitId)
  await seedService(orgId, serviceId)
  await putUser(buildUser(userId, TS, { completionCompleted: true, whatsapp: '5511900000000' }))
  await seedMembership(orgId, userId, canBeBooked)
  const proId = id('pro')
  const pro: StoredProfessional = {
    id: proId,
    orgId,
    userId,
    defaultCommission: null,
    unitIds: [unitId],
    catalogServiceIds: [serviceId],
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
  return proId
}

const TABLES =
  'events, projections, professional_units, professional_services, professionals, catalog_items, memberships, units, orgs, users'

describe('loadApprovedProfessional — booking write gate keys on canBeBooked (brief 0076 AC-03)', () => {
  beforeEach(async () => {
    await pool().query(`TRUNCATE ${TABLES} CASCADE`)
  })
  afterAll(async () => {
    await closeEventStoreDb()
  })

  const UNIT = 'unit-1'
  const SERVICE = 'svc-1'

  it('operational professional WITH canBeBooked → ACCEPTS the booking', async () => {
    const orgId = uniqueOrg()
    await seedOrg(orgId)
    const proId = await seedOperationalProfessional(orgId, UNIT, SERVICE, true)
    const result = await loadApprovedProfessional(orgId, proId)
    expect(typeof result).not.toBe('string')
  })

  it('operational professional with canBeBooked OFF → REFUSES the booking (capability gate)', async () => {
    const orgId = uniqueOrg()
    await seedOrg(orgId)
    // Operational on every readiness axis, but the capability was toggled off
    // (soft-disabled — out of the grid). The write must refuse it too.
    const proId = await seedOperationalProfessional(orgId, UNIT, SERVICE, false)
    const result = await loadApprovedProfessional(orgId, proId)
    expect(typeof result).toBe('string')
    expect(result).toContain('capacidade de agenda')
  })
})
