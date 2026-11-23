import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ readUnderRls: vi.fn() }))
vi.mock('@/shared/db/pg/rls-read', () => ({ readUnderRls: mocks.readUnderRls }))

import {
  listAppointmentsByMemberOperationId,
  listMemberOperationAppointmentsInRange,
  listUnitAppointmentsInRange,
} from './appointment-read'

const APPOINTMENT_ROW = {
  org_id: 'org-1',
  id: 'apt-1',
  unit_id: 'u1',
  version: 1,
  member_operation_id: 'pro-1',
  customer_id: 'c1',
  service_id: 'svc-1',
  customer_user_id: 'user-9',
  member_operator_user_id: 'user-1',
  start_at: '2026-06-10T14:00:00.000Z',
  end_at: '2026-06-10T14:30:00.000Z',
  status: 'scheduled',
  service_price_cents_snapshot: 5000,
  service_duration_minutes_snapshot: 30,
  commission_snapshot: null,
  cancellation_policy_snapshot: null,
  tracking: null,
  created_at: '2026-06-01T00:00:00.000Z',
  updated_at: '2026-06-01T00:00:00.000Z',
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('listAppointmentsByMemberOperationId', () => {
  it('maps the typed appointments rows under RLS', async () => {
    mocks.readUnderRls.mockResolvedValue([APPOINTMENT_ROW])
    const appts = await listAppointmentsByMemberOperationId('org-1', 'pro-1')
    expect(appts).toHaveLength(1)
    expect(appts[0]).toMatchObject({
      id: 'apt-1',
      memberOperationId: 'pro-1',
      status: 'scheduled',
      unitId: 'u1',
    })
  })

  it('returns empty when the memberOperation has none', async () => {
    mocks.readUnderRls.mockResolvedValue([])
    expect(await listAppointmentsByMemberOperationId('org-1', 'pro-1')).toHaveLength(0)
  })
})

describe('listUnitAppointmentsInRange', () => {
  const RANGE = { startUtc: '2026-06-10T00:00:00.000Z', endUtc: '2026-06-10T23:59:59.999Z' }

  function captureQuery(): { sql: () => string } {
    let captured = ''
    mocks.readUnderRls.mockImplementation(async (_orgId: string, run: (c: unknown) => unknown) => {
      const fakeClient = {
        query: (sql: string) => {
          captured = sql
          return Promise.resolve({ rows: [] })
        },
      }
      await run(fakeClient)
      return []
    })
    return { sql: () => captured }
  }

  it('excludes cancelled by default (AC-01)', async () => {
    const cap = captureQuery()
    await listUnitAppointmentsInRange('org-1', 'u1', RANGE)
    expect(cap.sql()).toContain("status <> 'cancelled'")
  })

  it('keeps scheduled and other active statuses — filters only cancelled (AC-02)', async () => {
    const cap = captureQuery()
    await listUnitAppointmentsInRange('org-1', 'u1', RANGE)
    const sql = cap.sql()
    expect(sql).toContain("status <> 'cancelled'")
    expect(sql).not.toMatch(/status\s*=\s*/)
    expect(sql).not.toContain('no_show')
  })

  it('includes cancelled when the toggle is on (AC-03)', async () => {
    const cap = captureQuery()
    await listUnitAppointmentsInRange('org-1', 'u1', RANGE, { includeCancelled: true })
    expect(cap.sql()).not.toContain('status')
  })

  it('maps the typed rows the read returns', async () => {
    mocks.readUnderRls.mockResolvedValue([APPOINTMENT_ROW])
    const appts = await listUnitAppointmentsInRange('org-1', 'u1', RANGE)
    expect(appts).toHaveLength(1)
    expect(appts[0]).toMatchObject({ id: 'apt-1', unitId: 'u1', status: 'scheduled' })
  })
})

describe('listMemberOperationAppointmentsInRange (#1313 — cross-unit)', () => {
  const RANGE = { startUtc: '2026-06-10T00:00:00.000Z', endUtc: '2026-06-10T23:59:59.999Z' }

  function captureQuery(): { sql: () => string; params: () => unknown[] } {
    let sql = ''
    let params: unknown[] = []
    mocks.readUnderRls.mockImplementation(async (_orgId: string, run: (c: unknown) => unknown) => {
      const fakeClient = {
        query: (q: string, p: unknown[]) => {
          sql = q
          params = p
          return Promise.resolve({ rows: [] })
        },
      }
      await run(fakeClient)
      return []
    })
    return { sql: () => sql, params: () => params }
  }

  it('filters by member_operation_id and NOT by unit_id (the whole point)', async () => {
    const cap = captureQuery()
    await listMemberOperationAppointmentsInRange('org-1', 'pro-1', RANGE)
    const sql = cap.sql()
    expect(sql).toContain('member_operation_id = $2')
    expect(sql).not.toContain('unit_id')
    expect(sql).toContain("status <> 'cancelled'")
    expect(cap.params()).toEqual(['org-1', 'pro-1', RANGE.startUtc, RANGE.endUtc])
  })

  it('maps the typed rows the read returns', async () => {
    mocks.readUnderRls.mockResolvedValue([APPOINTMENT_ROW])
    const appts = await listMemberOperationAppointmentsInRange('org-1', 'pro-1', RANGE)
    expect(appts).toHaveLength(1)
    expect(appts[0]).toMatchObject({ id: 'apt-1', memberOperationId: 'pro-1', status: 'scheduled' })
  })
})
