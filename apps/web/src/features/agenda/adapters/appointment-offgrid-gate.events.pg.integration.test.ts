// Server-side slot-grid refusal proof (brief 0080, Grupo A — AC-01/02/03):
// `createAppointment` and `updateAppointment` reject a `startAt` that does not
// land on the unit's configured slot grid (inside business hours), no matter
// what the client posts — a forged/stale POST is barred at the action.
//
// Seam: the full reception actions run against REAL Postgres; only the session
// (`getSessionUser`) is mocked, so `requireOrgCtx` resolves the seeded
// membership exactly like production. The unit is in APPOINTMENT mode with
// Mon–Fri 09:00–12:00 BR business hours on a 30-min grid, so 09:15 is off-grid
// and 10:00 is on-grid. The test asserts BOTH the refusal AND the absence of
// the side-effect event (no `appointment.created` / `appointment.rescheduled`).

import { defaultPermissionsForRole, normalizeBrazilPhone, type Role } from '@/domain'
import { closeEventStoreDb, getEventStorePool } from '@/shared/db/pg/pool'
import { putUser } from '@/shared/db/pg/users-store'
import type { SessionUser } from '@/shared/firebase/admin'
import { buildStoredCustomer, buildUser } from '@/shared/fixtures/domain-builders'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getSessionUser: vi.fn<() => Promise<SessionUser | null>>() }))
vi.mock('@/shared/firebase/admin', () => ({ getSessionUser: mocks.getSessionUser }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { createAppointment, updateAppointment } from './agenda.actions'

const TS = '2026-06-01T12:00:00.000Z'
// Mon–Fri 09:00–12:00 BR (= 12:00–15:00 UTC), 30-min grid. 2026-07-06 is a
// Monday. On-grid: 10:00 BR. Off-grid: 09:15 BR (between 30-min steps).
const BOOKING_DATE = '2026-07-06'
const ON_GRID_TIME = '10:00'
const OFF_GRID_TIME = '09:15'
const CUSTOMER_WHATSAPP = '11999990002'

let seq = 0
function uniqueOrg(): string {
  seq += 1
  return `offgrid-gate-${Date.now()}-${seq}`
}
function id(prefix: string): string {
  seq += 1
  return `${prefix}-${Date.now()}-${seq}`
}

function pool() {
  return getEventStorePool()
}

const APPOINTMENT_AGENDA = {
  mode: 'appointment',
  businessHours: {
    monday: { open: '09:00', close: '12:00' },
    tuesday: { open: '09:00', close: '12:00' },
    wednesday: { open: '09:00', close: '12:00' },
    thursday: { open: '09:00', close: '12:00' },
    friday: { open: '09:00', close: '12:00' },
    saturday: null,
    sunday: null,
  },
  slotMinutes: 30,
  cancellationPolicy: { enabled: false, minNoticeMinutes: 120 },
  confirmationTemplates: { confirmation: '', reminder: '', cancellation: '' },
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
     VALUES ($1,$2,1,'Unit','unit-'||$2,'America/Sao_Paulo','appointment','informal',$3::jsonb,$4::jsonb,$5::jsonb,NULL,$6,$6)
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
      JSON.stringify(APPOINTMENT_AGENDA),
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
  await putUser(buildUser(userId, TS, { currentOrgId: orgId, completionCompleted: true }))
}

async function seedCustomer(orgId: string, customerId: string): Promise<void> {
  const userId = id('cust-user')
  await putUser(
    buildUser(userId, TS, {
      completionCompleted: true,
      whatsapp: normalizeBrazilPhone(CUSTOMER_WHATSAPP),
    }),
  )
  const { CustomerConfig } = await import('@/domain/aggregates')
  const { aggregateRef, appendEvent } = await import('@/domain/effect')
  const { PostgresPersistenceLayer } = await import('@/shared/db/pg/effect/postgres-layer')
  const { Effect } = await import('effect')
  await Effect.runPromise(
    appendEvent(CustomerConfig, aggregateRef(CustomerConfig, orgId, customerId), {
      _tag: 'customer.created',
      actorId: 'test',
      payload: { data: buildStoredCustomer(customerId, orgId, userId, TS) },
    }).pipe(Effect.provide(PostgresPersistenceLayer)),
  )
}

async function seedOperationalMemberOperation(
  orgId: string,
  unitId: string,
  serviceId: string,
): Promise<string> {
  const { MemberOperationConfig } = await import('@/domain/aggregates')
  const { aggregateRef, appendEvent } = await import('@/domain/effect')
  const { PostgresPersistenceLayer } = await import('@/shared/db/pg/effect/postgres-layer')
  const { Effect } = await import('effect')
  const userId = id('pro-user')
  await putUser(buildUser(userId, TS, { completionCompleted: true }))
  await seedMembership(orgId, userId, 'member_operator')
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

function bookingForm(args: {
  unitId: string
  memberOperationId: string
  serviceId: string
  customerId: string
  startTime: string
}) {
  const fd = new FormData()
  fd.set('unitId', args.unitId)
  fd.set('memberOperationId', args.memberOperationId)
  fd.set('serviceId', args.serviceId)
  fd.set('customerMode', 'existing')
  fd.set('customerId', args.customerId)
  fd.set('date', BOOKING_DATE)
  fd.set('startTime', args.startTime)
  return fd
}

async function countEventsByTag(orgId: string, tag: string): Promise<number> {
  const res = await pool().query<{ n: string }>(
    "SELECT count(*)::text AS n FROM events WHERE org_id = $1 AND envelope->>'_tag' = $2",
    [orgId, tag],
  )
  return Number(res.rows[0]?.n ?? '0')
}

const TABLES =
  'events, projections, member_operation_units, member_operation_services, member_operations, appointments, customers, catalog_items, memberships, units, orgs, users, org_links'

describe('appointment write — slot-grid gate (brief 0080, Grupo A)', () => {
  const UNIT = 'unit-1'
  const SERVICE = 'svc-1'
  const CUSTOMER = 'cust-1'

  beforeEach(async () => {
    await pool().query(`TRUNCATE ${TABLES} CASCADE`)
    vi.clearAllMocks()
  })
  afterAll(async () => {
    await closeEventStoreDb()
  })

  async function setup(orgId: string): Promise<{ actorUid: string; proId: string }> {
    await seedOrg(orgId)
    const actorUid = id('actor')
    await seedActingUser(orgId, actorUid)
    await seedMembership(orgId, actorUid, 'receptionist')
    await seedUnit(orgId, UNIT)
    await seedService(orgId, SERVICE, UNIT)
    await seedCustomer(orgId, CUSTOMER)
    const proId = await seedOperationalMemberOperation(orgId, UNIT, SERVICE)
    mocks.getSessionUser.mockResolvedValue({
      uid: actorUid,
      email: null,
      displayName: null,
      picture: null,
      emailVerified: true,
    })
    return { actorUid, proId }
  }

  it('createAppointment REFUSES an off-grid startAt — no appointment.created event', async () => {
    const orgId = uniqueOrg()
    const { proId } = await setup(orgId)

    const result = await createAppointment(
      bookingForm({
        unitId: UNIT,
        memberOperationId: proId,
        serviceId: SERVICE,
        customerId: CUSTOMER,
        startTime: OFF_GRID_TIME,
      }),
    )

    expect(result.ok).toBe(false)
    expect(await countEventsByTag(orgId, 'appointment.created')).toBe(0)
  })

  it('createAppointment ALLOWS an on-grid startAt (happy path preserved)', async () => {
    const orgId = uniqueOrg()
    const { proId } = await setup(orgId)

    const result = await createAppointment(
      bookingForm({
        unitId: UNIT,
        memberOperationId: proId,
        serviceId: SERVICE,
        customerId: CUSTOMER,
        startTime: ON_GRID_TIME,
      }),
    )

    expect(result.ok).toBe(true)
    expect(await countEventsByTag(orgId, 'appointment.created')).toBe(1)
  })

  it('updateAppointment REFUSES a move to an off-grid startAt — no appointment.rescheduled event', async () => {
    const orgId = uniqueOrg()
    const { proId } = await setup(orgId)

    const created = await createAppointment(
      bookingForm({
        unitId: UNIT,
        memberOperationId: proId,
        serviceId: SERVICE,
        customerId: CUSTOMER,
        startTime: ON_GRID_TIME,
      }),
    )
    expect(created.ok).toBe(true)
    const appointmentId = created.ok ? created.appointmentId : ''
    expect(appointmentId).toBeTruthy()

    const moved = await updateAppointment(
      appointmentId,
      bookingForm({
        unitId: UNIT,
        memberOperationId: proId,
        serviceId: SERVICE,
        customerId: CUSTOMER,
        startTime: OFF_GRID_TIME,
      }),
    )

    expect(moved.ok).toBe(false)
    expect(await countEventsByTag(orgId, 'appointment.rescheduled')).toBe(0)
  })
})
