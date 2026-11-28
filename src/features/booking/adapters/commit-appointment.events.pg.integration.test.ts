import type { Appointment } from '@/domain'
import { closeEventStoreDb } from '@/shared/db/pg/pool'
import { ownerPool } from '@/shared/db/pg/test/owner-pool'
import { getAppointmentById } from '@/shared/org/appointment-read'
import type * as Log from '@cbrl/log'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { commitAppointmentBooking } from './commit-appointment'

const warnSpy = vi.hoisted(() => vi.fn())

vi.mock('@cbrl/log', async (importOriginal) => ({
  ...(await importOriginal<typeof Log>()),
  logger: { debug: vi.fn(), info: vi.fn(), warn: warnSpy, error: vi.fn() },
}))

function uniqueOrgId(label: string) {
  return `t-${label}-${Math.random().toString(36).slice(2, 8)}`
}

function buildAppointment(
  orgId: string,
  id: string,
  startAtIso: string,
  durationMinutes = 30,
): Appointment {
  const startMs = new Date(startAtIso).getTime()
  return {
    id,
    orgId,
    unitId: 'u1',
    memberOperationId: 'p1',
    customerId: `c-${id}`,
    serviceId: 's1',
    startAt: startAtIso,
    endAt: new Date(startMs + durationMinutes * 60_000).toISOString(),
    status: 'scheduled',
    servicePriceCentsSnapshot: 5000,
    serviceDurationMinutesSnapshot: durationMinutes,
    commissionSnapshot: null,
    cancellationPolicySnapshot: null,
    customerUserId: `u-${id}`,
    memberOperatorUserId: null,
    attribution: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

async function seedOrg(orgId: string): Promise<void> {
  await ownerPool().query(
    `INSERT INTO orgs (org_id, id, last_event_version, name, slug, vertical, owner_user_id, branding, created_at, updated_at)
     VALUES ($1,$1,1,'Org','slug-'||$1,'barbershop','owner','{}'::jsonb,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')
     ON CONFLICT (org_id) DO NOTHING`,
    [orgId],
  )
}

async function seedUnit(orgId: string, unitId: string): Promise<void> {
  await ownerPool().query(
    `INSERT INTO units (org_id, id, last_event_version, name, slug, timezone, agenda_mode, fiscal_kind, address, agenda, fiscal, created_at, updated_at)
     VALUES ($1,$2,1,'Unit','unit-'||$2,'America/Sao_Paulo','always_open','informal','{"postalCode":"01310100","state":"SP","city":"São Paulo","neighborhood":"Bela Vista","street":"Avenida Paulista","number":"1000","complement":null}'::jsonb,'{}'::jsonb,'{}'::jsonb,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')
     ON CONFLICT (org_id, id) DO NOTHING`,
    [orgId, unitId],
  )
}

async function seedMemberOperation(orgId: string, memberOperationId: string): Promise<void> {
  await ownerPool().query(
    `INSERT INTO memberships (org_id, id, user_id, last_event_version, role, status, joined_at, permissions, updated_at)
     VALUES ($1,$1||'_'||('user-'||$2),'user-'||$2,1,'member_operator','active','2026-01-01T00:00:00Z','{}'::jsonb,'2026-01-01T00:00:00Z')
     ON CONFLICT (org_id, id) DO NOTHING`,
    [orgId, memberOperationId],
  )
  await ownerPool().query(
    `INSERT INTO member_operations (org_id, id, last_event_version, user_id, member_id, default_commission, unit_ids, catalog_service_ids, created_at, updated_at)
     VALUES ($1,$2,1,'user-'||$2,$1||'_'||('user-'||$2),NULL,'[]'::jsonb,'[]'::jsonb,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')
     ON CONFLICT (org_id, id) DO NOTHING`,
    [orgId, memberOperationId],
  )
}

async function seedService(orgId: string, serviceId: string): Promise<void> {
  await ownerPool().query(
    `INSERT INTO catalog_items (org_id, id, last_event_version, kind, name, category_id, price_cents, price_visibility, active, archived_at, duration_minutes, sku, stock, gtin14, reconciliation_pending, reconciliation_last_attempt, commission, unit_ids, unit_overrides, required_resources, public_visible, created_at, updated_at)
     VALUES ($1,$2,1,'service','Service',NULL,5000,'visible',true,NULL,30,NULL,NULL,NULL,NULL,NULL,NULL,'["unit-seed"]'::jsonb,NULL,NULL,false,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')
     ON CONFLICT (org_id, id) DO NOTHING`,
    [orgId, serviceId],
  )
}

async function seedCustomer(orgId: string, customerId: string, userId: string): Promise<void> {
  await ownerPool().query(
    `INSERT INTO customers (org_id, id, last_event_version, user_id, archived_at, deactivated_at, created_at, updated_at)
     VALUES ($1,$2,1,$3,NULL,NULL,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')
     ON CONFLICT (org_id, id) DO NOTHING`,
    [orgId, customerId, userId],
  )
}

const commit = async (
  orgId: string,
  appt: Appointment,
  actorUid = 'staff',
  via = 'internal_panel',
) => {
  await seedCustomer(orgId, appt.customerId, appt.customerUserId)
  return commitAppointmentBooking({ orgId, appointment: appt, actorUid, via })
}

describe('commitAppointmentBooking — Postgres anti-double-book (#843)', () => {
  let orgId: string

  beforeEach(async () => {
    orgId = uniqueOrgId('book')
    warnSpy.mockClear()
    await ownerPool().query(
      'TRUNCATE events, projections, appointments, customers, member_operations, catalog_items, units, orgs CASCADE',
    )
    await seedOrg(orgId)
    await seedUnit(orgId, 'u1')
    await seedMemberOperation(orgId, 'p1')
    await seedMemberOperation(orgId, 'p2')
    await seedService(orgId, 's1')
  })

  afterAll(async () => {
    await closeEventStoreDb()
  })

  it('writes a single appointment when there is no contention', async () => {
    const res = await commit(orgId, buildAppointment(orgId, 'a1', '2026-08-15T13:00:00.000Z'))
    expect(res).toEqual({ ok: true })
    const written = await getAppointmentById(orgId, 'a1')
    expect(written).not.toBeNull()
  })

  it('round-trips startAt/endAt as ISO 8601 — no timestamptz format drift', async () => {
    await commit(orgId, buildAppointment(orgId, 'iso', '2026-08-15T13:00:00.000Z'))
    const written = await getAppointmentById(orgId, 'iso')
    expect(written?.startAt).toBe('2026-08-15T13:00:00.000Z')
    expect(written?.endAt).toBe('2026-08-15T13:30:00.000Z')
  })

  it('rejects an overlapping appointment for the same memberOperation', async () => {
    await commit(orgId, buildAppointment(orgId, 'first', '2026-08-15T13:00:00.000Z'))

    const res = await commit(
      orgId,
      buildAppointment(orgId, 'second', '2026-08-15T13:15:00.000Z'),
      'public:c-second',
      'public_landing',
    )
    expect(res).toEqual({ ok: false, error: 'slot_taken' })

    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy).toHaveBeenCalledWith(
      'appointment.double_book_blocked',
      expect.objectContaining({ appointmentId: 'second', memberOperationId: 'p1' }),
    )
  })

  it('allows back-to-back appointments (half-open intervals)', async () => {
    await commit(orgId, buildAppointment(orgId, 'a', '2026-08-15T13:00:00.000Z', 30))
    const res = await commit(orgId, buildAppointment(orgId, 'b', '2026-08-15T13:30:00.000Z', 30))
    expect(res).toEqual({ ok: true })
  })

  it('lets a new booking reuse the slot after the first is cancelled', async () => {
    await commit(orgId, buildAppointment(orgId, 'taken', '2026-08-15T13:00:00.000Z'))
    await ownerPool().query(
      `UPDATE appointments SET status = 'cancelled' WHERE org_id = $1 AND id = $2`,
      [orgId, 'taken'],
    )
    const res = await commit(orgId, buildAppointment(orgId, 'rebook', '2026-08-15T13:00:00.000Z'))
    expect(res).toEqual({ ok: true })
  })

  it('serializes concurrent writers — exactly one wins, the rest get slot_taken', async () => {
    const startAt = '2026-08-15T14:00:00.000Z'
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        commit(orgId, buildAppointment(orgId, `race-${i}`, startAt), `public:race-${i}`),
      ),
    )
    expect(results.filter((r) => r.ok)).toHaveLength(1)
    const failures = results.filter((r) => !r.ok)
    expect(failures).toHaveLength(5)
    for (const f of failures) expect(f).toEqual({ ok: false, error: 'slot_taken' })
  }, 30_000)

  it('lets two different memberOperations book the same slot', async () => {
    const startAt = '2026-08-15T15:00:00.000Z'
    const apptA = buildAppointment(orgId, 'a', startAt)
    const apptB = buildAppointment(orgId, 'b', startAt)
    const withPro2: Appointment = { ...apptB, memberOperationId: 'p2' }
    const [resA, resB] = await Promise.all([commit(orgId, apptA), commit(orgId, withPro2)])
    expect(resA).toEqual({ ok: true })
    expect(resB).toEqual({ ok: true })
  })
})
