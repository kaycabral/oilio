import { type AgendaBlock, type Role, defaultPermissionsForRole, membershipDocId } from '@/domain'
import { AppointmentConfig } from '@/domain/aggregates'
import { aggregateRef } from '@/domain/effect'
import {
  AGENDA_BLOCK_COLUMNS,
  agendaBlockColumnValues,
} from '@/shared/db/pg/effect/agenda-block-projector'
import {
  APPOINTMENT_COLUMNS,
  appointmentColumnValues,
} from '@/shared/db/pg/effect/appointment-projector'
import { upsertInvitePii } from '@/shared/db/pg/pii-sidecars-store'
import { closeEventStoreDb, getEventStorePool } from '@/shared/db/pg/pool'
import { putUser } from '@/shared/db/pg/users-store'
import { buildAppointment, buildUser } from '@/shared/fixtures/domain-builders'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { offboardMemberInOrg } from './offboard-member'

const TS = '2026-06-01T12:00:00.000Z'
const FUTURE = new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString()
const PAST = new Date(Date.now() - 7 * 24 * 60 * 60_000).toISOString()

let seq = 0
function uniqueId(prefix: string): string {
  seq += 1
  return `${prefix}-${Date.now()}-${seq}`
}

function uniquePhone(): string {
  seq += 1
  const suffix = String(seq).padStart(8, '0').slice(-8)
  return `5511 9${suffix}`.replace(/\s/g, '')
}

async function seedOrg(orgId: string): Promise<void> {
  await getEventStorePool().query(
    `INSERT INTO orgs (org_id, id, last_event_version, name, slug, vertical, owner_user_id, branding, created_at, updated_at)
     VALUES ($1,$1,1,'Org','slug-'||$1,'barbershop','owner','{}'::jsonb,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`,
    [orgId],
  )
}

async function seedUnit(orgId: string, unitId: string): Promise<void> {
  await getEventStorePool().query(
    `INSERT INTO units (org_id, id, last_event_version, name, slug, timezone, agenda_mode, fiscal_kind, address, agenda, fiscal, created_at, updated_at)
     VALUES ($1,$2,1,'Unit','unit-'||$2,'America/Sao_Paulo','always_open','informal','{"postalCode":"01310100","state":"SP","city":"São Paulo","neighborhood":"Bela Vista","street":"Avenida Paulista","number":"1000","complement":null}'::jsonb,'{}'::jsonb,'{}'::jsonb,$3,$3)
     ON CONFLICT (org_id, id) DO NOTHING`,
    [orgId, unitId, TS],
  )
}

async function seedCustomer(orgId: string, customerId: string): Promise<void> {
  await getEventStorePool().query(
    `INSERT INTO customers (org_id, id, last_event_version, user_id, archived_at, deactivated_at, created_at, updated_at)
     VALUES ($1,$2,1,'user-'||$2,NULL,NULL,$3,$3)
     ON CONFLICT (org_id, id) DO NOTHING`,
    [orgId, customerId, TS],
  )
}

async function seedService(orgId: string, serviceId: string): Promise<void> {
  await getEventStorePool().query(
    `INSERT INTO catalog_items (org_id, id, last_event_version, kind, name, category_id, price_cents, price_visibility, active, archived_at, duration_minutes, sku, stock, gtin14, reconciliation_pending, reconciliation_last_attempt, commission, unit_ids, unit_overrides, required_resources, public_visible, created_at, updated_at)
     VALUES ($1,$2,1,'service','Service',NULL,5000,'visible',true,NULL,30,NULL,NULL,NULL,NULL,NULL,NULL,'["unit-seed"]'::jsonb,NULL,NULL,false,$3,$3)
     ON CONFLICT (org_id, id) DO NOTHING`,
    [orgId, serviceId, TS],
  )
}

async function seedMembership(orgId: string, userId: string, role: Role): Promise<string> {
  const id = membershipDocId(orgId, userId)
  await getEventStorePool().query(
    `INSERT INTO memberships (org_id, id, user_id, last_event_version, role, status, rls_unit_scope, invited_by, joined_at, permissions, updated_at)
     VALUES ($1,$2,$3,1,$4,'active',NULL,NULL,$5,$6::jsonb,$5)`,
    [orgId, id, userId, role, TS, JSON.stringify(defaultPermissionsForRole(role))],
  )
  return id
}

async function seedMemberOperation(
  orgId: string,
  userId: string,
  unitIds: string[] = [],
): Promise<string> {
  const id = uniqueId('pro')
  await putUser(buildUser(userId, TS, { completionCompleted: true }))
  const serviceId = unitIds.length > 0 ? uniqueId('svc') : null
  const catalogServiceIds = serviceId ? [serviceId] : []
  if (serviceId) await seedService(orgId, serviceId)
  await getEventStorePool().query(
    `INSERT INTO memberships (org_id, id, user_id, last_event_version, role, status, joined_at, permissions, updated_at)
     VALUES ($1,$1||'_'||$2,$2,1,'member_operator','active',$3,'{}'::jsonb,$3)
     ON CONFLICT (org_id, id) DO NOTHING`,
    [orgId, userId, TS],
  )
  await getEventStorePool().query(
    `INSERT INTO member_operations (org_id, id, last_event_version, user_id, member_id, default_commission, unit_ids, catalog_service_ids, created_at, updated_at)
     VALUES ($1,$2,1,$3,$1||'_'||$3,NULL,$4::jsonb,$5::jsonb,$6,$6)`,
    [orgId, id, userId, JSON.stringify(unitIds), JSON.stringify(catalogServiceIds), TS],
  )
  await getEventStorePool().query(
    `INSERT INTO member_operations_pii (org_id, id, tax_identity) VALUES ($1,$2,NULL)`,
    [orgId, id],
  )
  for (const unitId of unitIds) {
    await seedUnit(orgId, unitId)
    await getEventStorePool().query(
      `INSERT INTO member_operation_units (org_id, member_operation_id, unit_id) VALUES ($1,$2,$3)
       ON CONFLICT DO NOTHING`,
      [orgId, id, unitId],
    )
  }
  for (const sid of catalogServiceIds) {
    await getEventStorePool().query(
      `INSERT INTO member_operation_services (org_id, member_operation_id, service_id) VALUES ($1,$2,$3)
       ON CONFLICT DO NOTHING`,
      [orgId, id, sid],
    )
  }
  return id
}

async function seedAppointment(
  orgId: string,
  memberOperationId: string,
  startAt: string,
  status: 'scheduled' | 'completed' = 'scheduled',
): Promise<string> {
  const id = uniqueId('appt')
  const appt = buildAppointment(id, orgId, TS, {
    memberOperationId,
    startAt,
    endAt: startAt,
    status,
  })
  await seedUnit(orgId, appt.unitId)
  await seedCustomer(orgId, appt.customerId)
  await seedService(orgId, appt.serviceId)
  const placeholders = APPOINTMENT_COLUMNS.map((_, i) => `$${i + 1}`).join(', ')
  const orgIdRef = `$${APPOINTMENT_COLUMNS.indexOf('org_id') + 1}`
  const memberOpIdRef = `$${APPOINTMENT_COLUMNS.indexOf('member_operation_id') + 1}`
  const memberIdDerived = `(SELECT mo.member_id FROM member_operations mo WHERE mo.org_id = ${orgIdRef} AND mo.id = ${memberOpIdRef})`
  await getEventStorePool().query(
    `INSERT INTO appointments (${[...APPOINTMENT_COLUMNS, 'member_id'].join(', ')}) VALUES (${placeholders}, ${memberIdDerived})`,
    appointmentColumnValues(appt, aggregateRef(AppointmentConfig, orgId, id), 1),
  )
  return id
}

async function seedAgendaBlock(orgId: string, memberOperationId: string | null): Promise<string> {
  const id = uniqueId('blk')
  const block: AgendaBlock = {
    id,
    orgId,
    unitId: 'unit-1',
    memberOperationId,
    reason: 'férias',
    kind: 'one_off',
    weekday: null,
    open: null,
    close: null,
    startAt: TS,
    endAt: new Date(Date.parse(TS) + 60 * 60_000).toISOString(),
    createdAt: TS,
    updatedAt: TS,
  }
  await seedUnit(orgId, block.unitId)
  const placeholders = AGENDA_BLOCK_COLUMNS.map((_, i) => `$${i + 1}`).join(', ')
  const orgIdRef = `$${AGENDA_BLOCK_COLUMNS.indexOf('org_id') + 1}`
  const memberOpIdRef = `$${AGENDA_BLOCK_COLUMNS.indexOf('member_operation_id') + 1}`
  const memberIdDerived = `(SELECT mo.member_id FROM member_operations mo WHERE mo.org_id = ${orgIdRef} AND mo.id = ${memberOpIdRef})`
  await getEventStorePool().query(
    `INSERT INTO agenda_blocks (${[...AGENDA_BLOCK_COLUMNS, 'member_id'].join(', ')}) VALUES (${placeholders}, ${memberIdDerived})`,
    agendaBlockColumnValues(block, 1),
  )
  return id
}

async function seedOpenOrder(
  orgId: string,
  attributedUserId: string,
  status: 'open' | 'closed' = 'open',
): Promise<void> {
  const id = uniqueId('order')
  const items = JSON.stringify([
    {
      id: 'item-1',
      kind: 'service',
      refId: 'svc-1',
      name: 'Corte',
      quantity: 1,
      unitPriceCents: 1000,
      commission: null,
      attributedUserId,
    },
  ])
  const closedAt = status === 'closed' ? TS : null
  const paymentMethod = status === 'closed' ? 'cash' : null
  await seedUnit(orgId, 'unit-1')
  await seedCustomer(orgId, 'cust-1')
  await getEventStorePool().query(
    `INSERT INTO orders (org_id, id, unit_id, last_event_version, customer_id, appointment_id, status, closed_at, payment_method, discount_cents, subtotal_cents, total_cents, items, created_at, updated_at)
     VALUES ($1,$2,'unit-1',1,'cust-1',NULL,$3,$4,$5,0,1000,1000,$6::jsonb,$7,$7)`,
    [orgId, id, status, closedAt, paymentMethod, items, TS],
  )
}

async function seedUser(userId: string, mobile: string): Promise<void> {
  await putUser(buildUser(userId, TS, { mobile, displayName: 'Member' }))
}

async function seedInvite(
  orgId: string,
  mobile: string,
  status: 'pending' | 'accepted' = 'pending',
): Promise<string> {
  const id = uniqueId('inv')
  const accepted = status === 'accepted'
  await getEventStorePool().query(
    `INSERT INTO invites (org_id, id, last_event_version, role, token_hash, expires_at, status, invited_by, accepted_by_uid, accepted_at, created_at, updated_at)
     VALUES ($1,$2,1,'member_operator','hash',$3,$4,'owner-1',$5,$6,$7,$7)`,
    [
      orgId,
      id,
      new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString(),
      status,
      accepted ? 'someone' : null,
      accepted ? TS : null,
      TS,
    ],
  )
  await upsertInvitePii({ orgId, id, mobile })
  return id
}

async function statusOf(table: string, orgId: string, id: string): Promise<string | undefined> {
  const res = await getEventStorePool().query<{ status: string }>(
    `SELECT status FROM ${table} WHERE org_id = $1 AND id = $2`,
    [orgId, id],
  )
  return res.rows[0]?.status
}

async function membershipStatus(orgId: string, membershipId: string): Promise<string | undefined> {
  const res = await getEventStorePool().query<{ status: string }>(
    'SELECT status FROM memberships WHERE org_id = $1 AND id = $2',
    [orgId, membershipId],
  )
  return res.rows[0]?.status
}

async function rowExists(table: string, orgId: string, id: string): Promise<boolean> {
  const res = await getEventStorePool().query(
    `SELECT 1 FROM ${table} WHERE org_id = $1 AND id = $2`,
    [orgId, id],
  )
  return (res.rowCount ?? 0) > 0
}

async function piiExists(table: string, orgId: string, id: string): Promise<boolean> {
  const res = await getEventStorePool().query(
    `SELECT 1 FROM ${table} WHERE org_id = $1 AND id = $2`,
    [orgId, id],
  )
  return (res.rowCount ?? 0) > 0
}

async function countRevokedEvents(orgId: string, membershipId: string): Promise<number> {
  const res = await getEventStorePool().query<{ n: number }>(
    `SELECT count(*)::int AS n FROM events
       WHERE org_id = $1
         AND aggregate_id = $2
         AND envelope->>'_tag' = 'membership.updated'
         AND envelope #>> '{payload,changes,status}' = 'revoked'`,
    [orgId, membershipId],
  )
  return res.rows[0]?.n ?? 0
}

const TABLES =
  'events, projections, appointments, agenda_blocks, orders, member_operations, member_operations_pii, invites, invites_pii, memberships, units, customers, catalog_items, users, orgs'

describe('offboardMemberInOrg — core (Postgres)', () => {
  beforeEach(async () => {
    await getEventStorePool().query(`TRUNCATE ${TABLES} CASCADE`)
  })
  afterAll(async () => {
    await closeEventStoreDb()
  })

  it('ends membership (revoked), RETAINS the memberOperation projection + PII', async () => {
    const orgId = uniqueId('org')
    const userId = uniqueId('user')
    const actorId = uniqueId('actor')
    await seedOrg(orgId)
    const membershipId = await seedMembership(orgId, userId, 'member_operator')
    const proId = await seedMemberOperation(orgId, userId)

    const res = await offboardMemberInOrg(orgId, userId, actorId)
    expect(res.ok).toBe(true)

    expect(await membershipStatus(orgId, membershipId)).toBe('revoked')
    expect(await countRevokedEvents(orgId, membershipId)).toBe(1)
    expect(await rowExists('member_operations', orgId, proId)).toBe(true)
    expect(await piiExists('member_operations_pii', orgId, proId)).toBe(true)
  })

  it('is idempotent — re-running is a no-op (no throw, no double-event)', async () => {
    const orgId = uniqueId('org')
    const userId = uniqueId('user')
    const actorId = uniqueId('actor')
    await seedOrg(orgId)
    const membershipId = await seedMembership(orgId, userId, 'member_operator')
    const proId = await seedMemberOperation(orgId, userId)

    expect((await offboardMemberInOrg(orgId, userId, actorId)).ok).toBe(true)
    expect((await offboardMemberInOrg(orgId, userId, actorId)).ok).toBe(true)

    expect(await membershipStatus(orgId, membershipId)).toBe('revoked')
    expect(await countRevokedEvents(orgId, membershipId)).toBe(1)
    expect(await piiExists('member_operations_pii', orgId, proId)).toBe(true)
  })

  it('refuses to offboard the owner', async () => {
    const orgId = uniqueId('org')
    const userId = uniqueId('user')
    const actorId = uniqueId('actor')
    await seedOrg(orgId)
    const membershipId = await seedMembership(orgId, userId, 'owner')

    const res = await offboardMemberInOrg(orgId, userId, actorId)
    expect(res.ok).toBe(false)
    expect(await membershipStatus(orgId, membershipId)).toBe('active')
  })

  it('offboards a non-memberOperation member (no projection to deactivate)', async () => {
    const orgId = uniqueId('org')
    const userId = uniqueId('user')
    const actorId = uniqueId('actor')
    await seedOrg(orgId)
    const membershipId = await seedMembership(orgId, userId, 'receptionist')

    const res = await offboardMemberInOrg(orgId, userId, actorId)
    expect(res.ok).toBe(true)
    expect(await membershipStatus(orgId, membershipId)).toBe('revoked')
  })
})

describe('offboardMemberInOrg — cascade (Postgres)', () => {
  beforeEach(async () => {
    await getEventStorePool().query(`TRUNCATE ${TABLES} CASCADE`)
  })
  afterAll(async () => {
    await closeEventStoreDb()
  })

  it('AC-02: cancels FUTURE appointments (status flips, doc RETAINED), LEAVES past', async () => {
    const orgId = uniqueId('org')
    const userId = uniqueId('user')
    const actorId = uniqueId('actor')
    await seedOrg(orgId)
    await seedMembership(orgId, userId, 'member_operator')
    const proId = await seedMemberOperation(orgId, userId)
    const futureAppt = await seedAppointment(orgId, proId, FUTURE)
    const pastAppt = await seedAppointment(orgId, proId, PAST)

    const res = await offboardMemberInOrg(orgId, userId, actorId)
    expect(res.ok).toBe(true)

    expect(await statusOf('appointments', orgId, futureAppt)).toBe('cancelled')
    expect(await rowExists('appointments', orgId, futureAppt)).toBe(true)
    expect(await statusOf('appointments', orgId, pastAppt)).toBe('scheduled')
  })

  it('AC-07: removes the memberOperation agenda-blocks, LEAVES org-wide blocks', async () => {
    const orgId = uniqueId('org')
    const userId = uniqueId('user')
    const actorId = uniqueId('actor')
    await seedOrg(orgId)
    await seedMembership(orgId, userId, 'member_operator')
    const proId = await seedMemberOperation(orgId, userId)
    const proBlock = await seedAgendaBlock(orgId, proId)
    const orgBlock = await seedAgendaBlock(orgId, null)

    const res = await offboardMemberInOrg(orgId, userId, actorId)
    expect(res.ok).toBe(true)

    expect(await rowExists('agenda_blocks', orgId, proBlock)).toBe(false)
    expect(await rowExists('agenda_blocks', orgId, orgBlock)).toBe(true)
  })

  it('AC-05: REFUSES while an open comanda is attributed to the member (saga not started)', async () => {
    const orgId = uniqueId('org')
    const userId = uniqueId('user')
    const actorId = uniqueId('actor')
    await seedOrg(orgId)
    const membershipId = await seedMembership(orgId, userId, 'member_operator')
    const proId = await seedMemberOperation(orgId, userId)
    const futureAppt = await seedAppointment(orgId, proId, FUTURE)
    await seedOpenOrder(orgId, userId)

    const res = await offboardMemberInOrg(orgId, userId, actorId)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/comanda aberta/i)

    expect(await membershipStatus(orgId, membershipId)).toBe('active')
    expect(await statusOf('appointments', orgId, futureAppt)).toBe('scheduled')
  })

  it('AC-05: a CLOSED comanda does NOT block (only open vetoes)', async () => {
    const orgId = uniqueId('org')
    const userId = uniqueId('user')
    const actorId = uniqueId('actor')
    await seedOrg(orgId)
    const membershipId = await seedMembership(orgId, userId, 'member_operator')
    await seedMemberOperation(orgId, userId)
    await seedOpenOrder(orgId, userId, 'closed')

    const res = await offboardMemberInOrg(orgId, userId, actorId)
    expect(res.ok).toBe(true)
    expect(await membershipStatus(orgId, membershipId)).toBe('revoked')
  })

  it('AC-05: an open comanda attributed to ANOTHER member does NOT block', async () => {
    const orgId = uniqueId('org')
    const userId = uniqueId('user')
    const otherUserId = uniqueId('user')
    const actorId = uniqueId('actor')
    await seedOrg(orgId)
    const membershipId = await seedMembership(orgId, userId, 'member_operator')
    await seedMemberOperation(orgId, userId)
    await seedOpenOrder(orgId, otherUserId)

    const res = await offboardMemberInOrg(orgId, userId, actorId)
    expect(res.ok).toBe(true)
    expect(await membershipStatus(orgId, membershipId)).toBe('revoked')
  })

  it('idempotent re-run: cascade is safe to repeat (no throw, blocks already gone)', async () => {
    const orgId = uniqueId('org')
    const userId = uniqueId('user')
    const actorId = uniqueId('actor')
    await seedOrg(orgId)
    await seedMembership(orgId, userId, 'member_operator')
    const proId = await seedMemberOperation(orgId, userId)
    const futureAppt = await seedAppointment(orgId, proId, FUTURE)
    const proBlock = await seedAgendaBlock(orgId, proId)

    expect((await offboardMemberInOrg(orgId, userId, actorId)).ok).toBe(true)
    expect((await offboardMemberInOrg(orgId, userId, actorId)).ok).toBe(true)

    expect(await statusOf('appointments', orgId, futureAppt)).toBe('cancelled')
    expect(await rowExists('agenda_blocks', orgId, proBlock)).toBe(false)
  })
})

describe('offboardMemberInOrg — capacity/invites (Postgres)', () => {
  beforeEach(async () => {
    await getEventStorePool().query(`TRUNCATE ${TABLES} CASCADE`)
  })
  afterAll(async () => {
    await closeEventStoreDb()
  })

  it('AC-08: warns when removal leaves a unit with 0 active memberOperations', async () => {
    const orgId = uniqueId('org')
    const userId = uniqueId('user')
    const actorId = uniqueId('actor')
    await seedOrg(orgId)
    await seedMembership(orgId, userId, 'member_operator')
    await seedMemberOperation(orgId, userId, ['unit-solo'])

    const res = await offboardMemberInOrg(orgId, userId, actorId)
    expect(res.ok).toBe(true)
    if (res.ok) {
      const warn = res.warnings.find((w) => w.kind === 'unit-without-memberOperation')
      expect(warn?.unitIds).toEqual(['unit-solo'])
    }
  })

  it('AC-08: does NOT warn when another active memberOperation still staffs the unit', async () => {
    const orgId = uniqueId('org')
    const userId = uniqueId('user')
    const otherUserId = uniqueId('user')
    const actorId = uniqueId('actor')
    await seedOrg(orgId)
    await seedMembership(orgId, userId, 'member_operator')
    await seedMemberOperation(orgId, userId, ['unit-shared'])
    await seedMemberOperation(orgId, otherUserId, ['unit-shared'])

    const res = await offboardMemberInOrg(orgId, userId, actorId)
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.warnings).toEqual([])
  })

  it('AC-09: cleans the member PENDING invite (matched by WhatsApp) + its PII, leaves accepted', async () => {
    const orgId = uniqueId('org')
    const userId = uniqueId('user')
    const actorId = uniqueId('actor')
    const memberMobile = uniquePhone()
    const otherMobile = uniquePhone()
    await seedOrg(orgId)
    await seedMembership(orgId, userId, 'member_operator')
    await seedMemberOperation(orgId, userId)
    await seedUser(userId, memberMobile)
    const pendingInvite = await seedInvite(orgId, memberMobile, 'pending')
    const otherInvite = await seedInvite(orgId, otherMobile, 'pending')
    const acceptedInvite = await seedInvite(orgId, memberMobile, 'accepted')

    const res = await offboardMemberInOrg(orgId, userId, actorId)
    expect(res.ok).toBe(true)

    expect(await rowExists('invites', orgId, pendingInvite)).toBe(false)
    expect(await piiExists('invites_pii', orgId, pendingInvite)).toBe(false)
    expect(await rowExists('invites', orgId, otherInvite)).toBe(true)
    expect(await rowExists('invites', orgId, acceptedInvite)).toBe(true)
  })

  it('AC-09: idempotent — re-running finds no pending invite to clean', async () => {
    const orgId = uniqueId('org')
    const userId = uniqueId('user')
    const actorId = uniqueId('actor')
    const memberMobile = uniquePhone()
    await seedOrg(orgId)
    await seedMembership(orgId, userId, 'member_operator')
    await seedMemberOperation(orgId, userId)
    await seedUser(userId, memberMobile)
    const pendingInvite = await seedInvite(orgId, memberMobile, 'pending')

    expect((await offboardMemberInOrg(orgId, userId, actorId)).ok).toBe(true)
    expect((await offboardMemberInOrg(orgId, userId, actorId)).ok).toBe(true)
    expect(await rowExists('invites', orgId, pendingInvite)).toBe(false)
  })
})
