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

/**
 * Member offboarding saga against REAL Postgres (#1103/#1104/#1105, brief 0041 —
 * the rewrite of the Firestore-emulator `offboard-member.integration.test.ts`).
 * Post-cutover the whole offboard runs as ONE ACID transaction via `commitSaga`
 * (brief 0061 § Grupo C): membership revoked + professional suspended + future
 * appointments cancelled + the professional's agenda-blocks deleted + the
 * member's pending invites deleted, all in one tx; the `invites_pii` LGPD
 * sidecars are dropped post-commit. The owner is immune; the saga is vetoed
 * (before any mutation) by an OPEN comanda; re-running is idempotent; the vínculo
 * PII (`professionals_pii`) is RETAINED (art. 16).
 *
 * The production reads/writes run over the event-store pool (RLS bypassed
 * locally/CI — the policies are proven in the isolation specs). Preconditions are
 * seeded as typed projection rows (appointments/agenda-blocks via the projector
 * column mappers; memberships/professionals/orders/users/invites via the store
 * helpers or raw INSERT matching the schema). The cascade events read those
 * seeded projection docs and reproject. Per-run-unique ids; no global wipe.
 */

const TS = '2026-06-01T12:00:00.000Z'
const FUTURE = new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString()
const PAST = new Date(Date.now() - 7 * 24 * 60 * 60_000).toISOString()

let seq = 0
function uniqueId(prefix: string): string {
  seq += 1
  return `${prefix}-${Date.now()}-${seq}`
}

async function seedOrg(orgId: string): Promise<void> {
  await getEventStorePool().query(
    `INSERT INTO orgs (org_id, id, last_event_version, name, slug, vertical, owner_user_id, branding, created_at, updated_at)
     VALUES ($1,$1,1,'Org','slug-'||$1,'barbershop','owner','{}'::jsonb,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`,
    [orgId],
  )
}

// Idempotent FK-parent seeds (brief 0068 D2). The child projections
// (appointments/agenda_blocks/orders) carry composite FKs into
// units/customers/catalog_items; a case may seed several children sharing the
// same parent, so each is `ON CONFLICT DO NOTHING`.
async function seedUnit(orgId: string, unitId: string): Promise<void> {
  await getEventStorePool().query(
    `INSERT INTO units (org_id, id, last_event_version, name, slug, timezone, agenda_mode, fiscal_kind, address, agenda, fiscal, created_at, updated_at)
     VALUES ($1,$2,1,'Unit','unit-'||$2,'America/Sao_Paulo','always_open','informal','{}'::jsonb,'{}'::jsonb,'{}'::jsonb,$3,$3)
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
     VALUES ($1,$2,1,'service','Service',NULL,5000,'visible',true,NULL,30,NULL,NULL,NULL,NULL,NULL,NULL,'[]'::jsonb,NULL,NULL,false,$3,$3)
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

// Professional projection + its retained PII sidecar (must survive offboarding).
// `operationalStatus` is DERIVED on read (#1226 AC-02): operational ⇔ the linked
// User has a whatsapp ∧ ≥1 unit ∧ ≥1 service. So an OPERATIONAL seed must wire a
// whatsapp-bearing User + a service + the join rows; pass an empty `unitIds` (no
// units ⇒ derives `incomplete`) for a non-operational seed.
async function seedProfessional(
  orgId: string,
  userId: string,
  unitIds: string[] = [],
): Promise<string> {
  const id = uniqueId('pro')
  // The linked User carries the whatsapp the derive keys on (operational seed).
  await putUser(buildUser(userId, TS, { completionCompleted: true, whatsapp: '5511900000000' }))
  // One service so the derive's `≥1 service` axis is satisfied for an operational
  // seed; for a non-operational seed (`unitIds: []`) the missing unit floors it.
  const serviceId = unitIds.length > 0 ? uniqueId('svc') : null
  const catalogServiceIds = serviceId ? [serviceId] : []
  if (serviceId) await seedService(orgId, serviceId)
  // The operational profile hangs off the membership (brief 0076 AC-02) — ensure
  // the parent membership exists so the composite FK is satisfiable (idempotent;
  // the offboard cases seed their own membership status separately).
  await getEventStorePool().query(
    `INSERT INTO memberships (org_id, id, user_id, last_event_version, role, status, joined_at, permissions, updated_at)
     VALUES ($1,$1||'_'||$2,$2,1,'professional','active',$3,'{}'::jsonb,$3)
     ON CONFLICT (org_id, id) DO NOTHING`,
    [orgId, userId, TS],
  )
  await getEventStorePool().query(
    `INSERT INTO professionals (org_id, id, last_event_version, user_id, member_id, default_commission, unit_ids, catalog_service_ids, created_at, updated_at)
     VALUES ($1,$2,1,$3,$1||'_'||$3,NULL,$4::jsonb,$5::jsonb,$6,$6)`,
    [orgId, id, userId, JSON.stringify(unitIds), JSON.stringify(catalogServiceIds), TS],
  )
  await getEventStorePool().query(
    `INSERT INTO professionals_pii (org_id, id, tax_identity) VALUES ($1,$2,NULL)`,
    [orgId, id],
  )
  // Seeding professionals directly (not via the projector) must mirror the
  // `professional_units` / `professional_services` join rows the projector now
  // writes (brief 0068 D3) — the offboard re-projects the professional, and its
  // join writes need the parent unit/service rows to exist (composite FKs).
  for (const unitId of unitIds) {
    await seedUnit(orgId, unitId)
    await getEventStorePool().query(
      `INSERT INTO professional_units (org_id, professional_id, unit_id) VALUES ($1,$2,$3)
       ON CONFLICT DO NOTHING`,
      [orgId, id, unitId],
    )
  }
  for (const sid of catalogServiceIds) {
    await getEventStorePool().query(
      `INSERT INTO professional_services (org_id, professional_id, service_id) VALUES ($1,$2,$3)
       ON CONFLICT DO NOTHING`,
      [orgId, id, sid],
    )
  }
  return id
}

async function seedAppointment(
  orgId: string,
  professionalId: string,
  startAt: string,
  status: 'scheduled' | 'completed' = 'scheduled',
): Promise<string> {
  const id = uniqueId('appt')
  const appt = buildAppointment(id, orgId, TS, {
    professionalId,
    startAt,
    endAt: startAt,
    status,
  })
  // FK parents: appointment unit_id → units, customer_id → customers, service_id
  // → catalog_items (builder defaults unit 'unit', customer 'cust', service
  // 'svc'). professional_id already exists (seedProfessional ran first).
  await seedUnit(orgId, appt.unitId)
  await seedCustomer(orgId, appt.customerId)
  await seedService(orgId, appt.serviceId)
  const placeholders = APPOINTMENT_COLUMNS.map((_, i) => `$${i + 1}`).join(', ')
  await getEventStorePool().query(
    `INSERT INTO appointments (${APPOINTMENT_COLUMNS.join(', ')}) VALUES (${placeholders})`,
    appointmentColumnValues(appt, aggregateRef(AppointmentConfig, orgId, id), 1),
  )
  return id
}

async function seedAgendaBlock(orgId: string, professionalId: string | null): Promise<string> {
  const id = uniqueId('blk')
  const block: AgendaBlock = {
    id,
    orgId,
    unitId: 'unit-1',
    professionalId,
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
  // FK parent: agenda_block unit_id → units (block.unitId === 'unit-1').
  await seedUnit(orgId, block.unitId)
  const placeholders = AGENDA_BLOCK_COLUMNS.map((_, i) => `$${i + 1}`).join(', ')
  await getEventStorePool().query(
    `INSERT INTO agenda_blocks (${AGENDA_BLOCK_COLUMNS.join(', ')}) VALUES (${placeholders})`,
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
  // FK parents: order unit_id → units ('unit-1'), customer_id → customers
  // ('cust-1').
  await seedUnit(orgId, 'unit-1')
  await seedCustomer(orgId, 'cust-1')
  await getEventStorePool().query(
    `INSERT INTO orders (org_id, id, unit_id, last_event_version, customer_id, appointment_id, status, closed_at, payment_method, discount_cents, subtotal_cents, total_cents, items, created_at, updated_at)
     VALUES ($1,$2,'unit-1',1,'cust-1',NULL,$3,$4,$5,0,1000,1000,$6::jsonb,$7,$7)`,
    [orgId, id, status, closedAt, paymentMethod, items, TS],
  )
}

async function seedUser(userId: string, email: string): Promise<void> {
  await putUser(buildUser(userId, TS, { email, displayName: 'Member' }))
}

async function seedInvite(
  orgId: string,
  email: string,
  status: 'pending' | 'accepted' = 'pending',
): Promise<string> {
  const id = uniqueId('inv')
  const accepted = status === 'accepted'
  await getEventStorePool().query(
    `INSERT INTO invites (org_id, id, last_event_version, role, token_hash, expires_at, status, invited_by, accepted_by_uid, accepted_at, created_at, updated_at)
     VALUES ($1,$2,1,'professional','hash',$3,$4,'owner-1',$5,$6,$7,$7)`,
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
  await upsertInvitePii({ orgId, id, email })
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
  // The saga emits `membership.updated` with `payload.changes.status = 'revoked'`.
  // The event data lives in the `envelope` JSONB (`_tag` + `payload`).
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
  'events, projections, appointments, agenda_blocks, orders, professionals, professionals_pii, invites, invites_pii, memberships, units, customers, catalog_items, users, orgs'

describe('offboardMemberInOrg — core (Postgres)', () => {
  beforeEach(async () => {
    await getEventStorePool().query(`TRUNCATE ${TABLES} CASCADE`)
  })
  afterAll(async () => {
    await closeEventStoreDb()
  })

  it('ends membership (revoked), RETAINS the professional projection + PII', async () => {
    const orgId = uniqueId('org')
    const userId = uniqueId('user')
    const actorId = uniqueId('actor')
    await seedOrg(orgId)
    const membershipId = await seedMembership(orgId, userId, 'professional')
    const proId = await seedProfessional(orgId, userId)

    const res = await offboardMemberInOrg(orgId, userId, actorId)
    expect(res.ok).toBe(true)

    // Operability is severed by the REVOKED membership (every operational read
    // keys on an active membership) — not by a professional event (#1226 AC-02:
    // `operationalStatus` is derived on read, no `professional.suspended`).
    expect(await membershipStatus(orgId, membershipId)).toBe('revoked')
    expect(await countRevokedEvents(orgId, membershipId)).toBe(1)
    // Professional projection RETAINED (not deleted), reversible.
    expect(await rowExists('professionals', orgId, proId)).toBe(true)
    // RETENTION (art. 16): the vínculo PII is RETAINED.
    expect(await piiExists('professionals_pii', orgId, proId)).toBe(true)
  })

  it('is idempotent — re-running is a no-op (no throw, no double-event)', async () => {
    const orgId = uniqueId('org')
    const userId = uniqueId('user')
    const actorId = uniqueId('actor')
    await seedOrg(orgId)
    const membershipId = await seedMembership(orgId, userId, 'professional')
    const proId = await seedProfessional(orgId, userId)

    expect((await offboardMemberInOrg(orgId, userId, actorId)).ok).toBe(true)
    expect((await offboardMemberInOrg(orgId, userId, actorId)).ok).toBe(true)

    expect(await membershipStatus(orgId, membershipId)).toBe('revoked')
    expect(await countRevokedEvents(orgId, membershipId)).toBe(1)
    expect(await piiExists('professionals_pii', orgId, proId)).toBe(true)
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

  it('offboards a non-professional member (no projection to deactivate)', async () => {
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
    await seedMembership(orgId, userId, 'professional')
    const proId = await seedProfessional(orgId, userId)
    const futureAppt = await seedAppointment(orgId, proId, FUTURE)
    const pastAppt = await seedAppointment(orgId, proId, PAST)

    const res = await offboardMemberInOrg(orgId, userId, actorId)
    expect(res.ok).toBe(true)

    expect(await statusOf('appointments', orgId, futureAppt)).toBe('cancelled')
    expect(await rowExists('appointments', orgId, futureAppt)).toBe(true)
    // Past appointment LEFT untouched.
    expect(await statusOf('appointments', orgId, pastAppt)).toBe('scheduled')
  })

  it('AC-07: removes the professional agenda-blocks, LEAVES org-wide blocks', async () => {
    const orgId = uniqueId('org')
    const userId = uniqueId('user')
    const actorId = uniqueId('actor')
    await seedOrg(orgId)
    await seedMembership(orgId, userId, 'professional')
    const proId = await seedProfessional(orgId, userId)
    const proBlock = await seedAgendaBlock(orgId, proId)
    const orgBlock = await seedAgendaBlock(orgId, null)

    const res = await offboardMemberInOrg(orgId, userId, actorId)
    expect(res.ok).toBe(true)

    expect(await rowExists('agenda_blocks', orgId, proBlock)).toBe(false)
    // Org-wide block (professionalId == null) is NOT the member's — kept.
    expect(await rowExists('agenda_blocks', orgId, orgBlock)).toBe(true)
  })

  it('AC-05: REFUSES while an open comanda is attributed to the member (saga not started)', async () => {
    const orgId = uniqueId('org')
    const userId = uniqueId('user')
    const actorId = uniqueId('actor')
    await seedOrg(orgId)
    const membershipId = await seedMembership(orgId, userId, 'professional')
    const proId = await seedProfessional(orgId, userId)
    const futureAppt = await seedAppointment(orgId, proId, FUTURE)
    await seedOpenOrder(orgId, userId)

    const res = await offboardMemberInOrg(orgId, userId, actorId)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/comanda aberta/i)

    // Veto runs BEFORE any mutation: membership intact, appointment untouched.
    expect(await membershipStatus(orgId, membershipId)).toBe('active')
    expect(await statusOf('appointments', orgId, futureAppt)).toBe('scheduled')
  })

  it('AC-05: a CLOSED comanda does NOT block (only open vetoes)', async () => {
    const orgId = uniqueId('org')
    const userId = uniqueId('user')
    const actorId = uniqueId('actor')
    await seedOrg(orgId)
    const membershipId = await seedMembership(orgId, userId, 'professional')
    await seedProfessional(orgId, userId)
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
    const membershipId = await seedMembership(orgId, userId, 'professional')
    await seedProfessional(orgId, userId)
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
    await seedMembership(orgId, userId, 'professional')
    const proId = await seedProfessional(orgId, userId)
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

  it('AC-08: warns when removal leaves a unit with 0 active professionals', async () => {
    const orgId = uniqueId('org')
    const userId = uniqueId('user')
    const actorId = uniqueId('actor')
    await seedOrg(orgId)
    await seedMembership(orgId, userId, 'professional')
    await seedProfessional(orgId, userId, ['unit-solo'])

    const res = await offboardMemberInOrg(orgId, userId, actorId)
    expect(res.ok).toBe(true)
    if (res.ok) {
      const warn = res.warnings.find((w) => w.kind === 'unit-without-professional')
      expect(warn?.unitIds).toEqual(['unit-solo'])
    }
  })

  it('AC-08: does NOT warn when another active professional still staffs the unit', async () => {
    const orgId = uniqueId('org')
    const userId = uniqueId('user')
    const otherUserId = uniqueId('user')
    const actorId = uniqueId('actor')
    await seedOrg(orgId)
    await seedMembership(orgId, userId, 'professional')
    await seedProfessional(orgId, userId, ['unit-shared'])
    // Another operational professional remains on the same unit.
    await seedProfessional(orgId, otherUserId, ['unit-shared'])

    const res = await offboardMemberInOrg(orgId, userId, actorId)
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.warnings).toEqual([])
  })

  it('AC-09: cleans the member PENDING invite (matched by email) + its PII, leaves accepted', async () => {
    const orgId = uniqueId('org')
    const userId = uniqueId('user')
    const actorId = uniqueId('actor')
    const email = `${uniqueId('member')}@example.com`
    await seedOrg(orgId)
    await seedMembership(orgId, userId, 'professional')
    await seedProfessional(orgId, userId)
    await seedUser(userId, email)
    const pendingInvite = await seedInvite(orgId, email, 'pending')
    const otherInvite = await seedInvite(orgId, `${uniqueId('other')}@example.com`, 'pending')
    const acceptedInvite = await seedInvite(orgId, email, 'accepted')

    const res = await offboardMemberInOrg(orgId, userId, actorId)
    expect(res.ok).toBe(true)

    // The member's pending invite + its PII are gone.
    expect(await rowExists('invites', orgId, pendingInvite)).toBe(false)
    expect(await piiExists('invites_pii', orgId, pendingInvite)).toBe(false)
    // Another member's pending invite is untouched.
    expect(await rowExists('invites', orgId, otherInvite)).toBe(true)
    // An accepted (historical) invite for the same email is LEFT.
    expect(await rowExists('invites', orgId, acceptedInvite)).toBe(true)
  })

  it('AC-09: idempotent — re-running finds no pending invite to clean', async () => {
    const orgId = uniqueId('org')
    const userId = uniqueId('user')
    const actorId = uniqueId('actor')
    const email = `${uniqueId('member')}@example.com`
    await seedOrg(orgId)
    await seedMembership(orgId, userId, 'professional')
    await seedProfessional(orgId, userId)
    await seedUser(userId, email)
    const pendingInvite = await seedInvite(orgId, email, 'pending')

    expect((await offboardMemberInOrg(orgId, userId, actorId)).ok).toBe(true)
    expect((await offboardMemberInOrg(orgId, userId, actorId)).ok).toBe(true)
    expect(await rowExists('invites', orgId, pendingInvite)).toBe(false)
  })
})
