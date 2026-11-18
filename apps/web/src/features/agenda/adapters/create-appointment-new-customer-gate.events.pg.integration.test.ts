import { defaultPermissionsForRole, normalizeBrazilPhone, type Role } from '@/domain'
import type { SessionUser } from '@/shared/auth/session'
import { closeEventStoreDb, getEventStorePool } from '@/shared/db/pg/pool'
import { putUser } from '@/shared/db/pg/users-store'
import { buildUser } from '@/shared/fixtures/domain-builders'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getSessionUser: vi.fn<() => Promise<SessionUser | null>>() }))
vi.mock('@/shared/auth/session', () => ({ getSessionUser: mocks.getSessionUser }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { createAppointment } from './agenda.actions'

const TS = '2026-06-01T12:00:00.000Z'
const NEW_CUSTOMER_MOBILE = '11999990001'

let seq = 0
function uniqueOrg(): string {
  seq += 1
  return `newcust-gate-${Date.now()}-${seq}`
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
    `INSERT INTO units (org_id, id, last_event_version, name, slug, timezone, agenda_mode, fiscal_kind, address, agenda, fiscal, archived_at, created_at, updated_at)
     VALUES ($1,$2,1,'Unit','unit-'||$2,'America/Sao_Paulo','always_open','informal',$3::jsonb,$4::jsonb,$5::jsonb,NULL,$6,$6)
     ON CONFLICT (org_id, id) DO NOTHING`,
    [
      orgId,
      unitId,
      JSON.stringify({
        postalCode: '01310100',
        state: 'SP',
        city: 'São Paulo',
        neighborhood: 'Bela Vista',
        street: 'Avenida Paulista',
        number: '1000',
        complement: null,
      }),
      JSON.stringify({ mode: 'always_open' }),
      JSON.stringify({ kind: 'informal' }),
      TS,
    ],
  )
}

async function seedService(orgId: string, serviceId: string, unitId: string): Promise<void> {
  await pool().query(
    `INSERT INTO catalog_items (org_id, id, last_event_version, kind, name, category_id, price_cents, price_visibility, active, archived_at, duration_minutes, sku, stock, gtin14, reconciliation_pending, reconciliation_last_attempt, commission, unit_ids, unit_overrides, required_resources, public_visible, created_at, updated_at)
     VALUES ($1,$2,1,'service','Service',NULL,5000,'visible',true,NULL,30,NULL,NULL,NULL,NULL,NULL,NULL,$3::jsonb,NULL,'[]'::jsonb,false,$4,$4)
     ON CONFLICT (org_id, id) DO NOTHING`,
    [orgId, serviceId, JSON.stringify([unitId]), TS],
  )
}

async function seedMembership(orgId: string, userId: string, role: Role): Promise<void> {
  await pool().query(
    `INSERT INTO memberships (org_id, id, user_id, last_event_version, role, status, rls_unit_scope, invited_by, joined_at, permissions, updated_at)
     VALUES ($1,$2,$3,1,$4,'active',NULL,NULL,$5,$6::jsonb,$5)`,
    [
      orgId,
      `${orgId}_${userId}`,
      userId,
      role,
      TS,
      JSON.stringify(defaultPermissionsForRole(role)),
    ],
  )
}

async function seedActingUser(orgId: string, userId: string): Promise<void> {
  await putUser(
    buildUser(userId, TS, {
      currentOrgId: orgId,
      completionCompleted: true,
    }),
  )
}

async function seedOperationalMemberOperation(
  orgId: string,
  unitId: string,
  serviceId: string,
  actorUserId?: string,
): Promise<string> {
  const { MemberOperationConfig } = await import('@/domain/aggregates')
  const { aggregateRef, appendEvent } = await import('@/domain/effect')
  const { PostgresPersistenceLayer } = await import('@/shared/db/pg/effect/postgres-layer')
  const { Effect } = await import('effect')
  await seedUnit(orgId, unitId)
  await seedService(orgId, serviceId, unitId)
  let userId = actorUserId
  if (!userId) {
    userId = id('pro-user')
    await putUser(buildUser(userId, TS, { completionCompleted: true }))
    await seedMembership(orgId, userId, 'member_operator')
  }
  const proId = id('pro')
  await Effect.runPromise(
    appendEvent(MemberOperationConfig, aggregateRef(MemberOperationConfig, orgId, proId), {
      _tag: 'member_operation.created',
      actorId: 'test',
      payload: {
        data: {
          id: proId,
          orgId,
          userId,
          defaultCommission: null,
          unitIds: [unitId],
          catalogServiceIds: [serviceId],
          createdAt: TS,
          updatedAt: TS,
        },
      },
    }).pipe(Effect.provide(PostgresPersistenceLayer)),
  )
  return proId
}

function newCustomerForm(args: { unitId: string; memberOperationId: string; serviceId: string }) {
  const fd = new FormData()
  fd.set('unitId', args.unitId)
  fd.set('memberOperationId', args.memberOperationId)
  fd.set('serviceId', args.serviceId)
  fd.set('customerMode', 'new')
  fd.set('newCustomerName', 'Cliente Novo')
  fd.set('newCustomerMobile', NEW_CUSTOMER_MOBILE)
  fd.set('date', '2026-07-01')
  fd.set('startTime', '10:00')
  return fd
}

async function countCustomers(orgId: string): Promise<number> {
  const res = await pool().query<{ n: string }>(
    'SELECT count(*)::text AS n FROM customers WHERE org_id = $1',
    [orgId],
  )
  return Number(res.rows[0]?.n ?? '0')
}

async function countEventsByTag(orgId: string, tag: string): Promise<number> {
  const res = await pool().query<{ n: string }>(
    "SELECT count(*)::text AS n FROM events WHERE org_id = $1 AND envelope->>'_tag' = $2",
    [orgId, tag],
  )
  return Number(res.rows[0]?.n ?? '0')
}

async function countUsersByMobile(mobileRaw: string): Promise<number> {
  const mobile = normalizeBrazilPhone(mobileRaw)
  const res = await pool().query<{ n: string }>(
    'SELECT count(*)::text AS n FROM users WHERE mobile = $1',
    [mobile],
  )
  return Number(res.rows[0]?.n ?? '0')
}

const TABLES =
  'events, projections, member_operation_units, member_operation_services, member_operations, appointments, customers, catalog_items, memberships, units, orgs, users, org_links'

describe('createAppointment — inline newCustomer is gated on canManageCustomers (brief 0075, #1266)', () => {
  beforeEach(async () => {
    await pool().query(`TRUNCATE ${TABLES} CASCADE`)
    vi.clearAllMocks()
  })
  afterAll(async () => {
    await closeEventStoreDb()
  })

  const UNIT = 'unit-1'
  const SERVICE = 'svc-1'

  it('self-scoped member_operator (canManageCustomers=false) → REFUSED, no customer / event / PII written', async () => {
    const orgId = uniqueOrg()
    await seedOrg(orgId)
    const actorUid = id('actor')
    await seedActingUser(orgId, actorUid)
    await seedMembership(orgId, actorUid, 'member_operator')
    const proId = await seedOperationalMemberOperation(orgId, UNIT, SERVICE, actorUid)
    mocks.getSessionUser.mockResolvedValue({
      uid: actorUid,
      authUserId: actorUid,
      email: null,
      displayName: null,
      picture: null,
      emailVerified: true,
    })

    const result = await createAppointment(
      newCustomerForm({ unitId: UNIT, memberOperationId: proId, serviceId: SERVICE }),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe('Você não tem permissão para cadastrar novos clientes')
    }
    expect(await countCustomers(orgId)).toBe(0)
    expect(await countEventsByTag(orgId, 'customer.created')).toBe(0)
    expect(await countUsersByMobile(NEW_CUSTOMER_MOBILE)).toBe(0)
    expect(await countEventsByTag(orgId, 'appointment.created')).toBe(0)
  })

  it('balcão (receptionist, canManageCustomers=true) → creates the customer inline (happy path preserved)', async () => {
    const orgId = uniqueOrg()
    await seedOrg(orgId)
    const actorUid = id('actor')
    await seedActingUser(orgId, actorUid)
    await seedMembership(orgId, actorUid, 'receptionist')
    const proId = await seedOperationalMemberOperation(orgId, UNIT, SERVICE)
    mocks.getSessionUser.mockResolvedValue({
      uid: actorUid,
      authUserId: actorUid,
      email: null,
      displayName: null,
      picture: null,
      emailVerified: true,
    })

    const result = await createAppointment(
      newCustomerForm({ unitId: UNIT, memberOperationId: proId, serviceId: SERVICE }),
    )

    expect(result.ok).toBe(true)
    expect(await countCustomers(orgId)).toBe(1)
    expect(await countEventsByTag(orgId, 'customer.created')).toBe(1)
    expect(await countUsersByMobile(NEW_CUSTOMER_MOBILE)).toBe(1)
  })
})
