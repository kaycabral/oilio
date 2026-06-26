// Unit test for the appointment read (brief 0061 § Grupo C — AC-04). Postgres is
// the only backend post-cutover (#1202): the read decodes the typed `appointments`
// rows returned by `readUnderRls` (mocked here to canned rows — no DB). The
// full RLS round-trip is proven by the integration suite.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ readUnderRls: vi.fn() }))
vi.mock('@/shared/db/pg/rls-read', () => ({ readUnderRls: mocks.readUnderRls }))

import { listAppointmentsByProfessionalId } from './appointment-read'

const APPOINTMENT_ROW = {
  org_id: 'org-1',
  id: 'apt-1',
  unit_id: 'u1',
  version: 1,
  professional_id: 'pro-1',
  customer_id: 'c1',
  service_id: 'svc-1',
  customer_user_id: 'user-9',
  professional_user_id: 'user-1',
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

describe('listAppointmentsByProfessionalId', () => {
  it('maps the typed appointments rows under RLS', async () => {
    mocks.readUnderRls.mockResolvedValue([APPOINTMENT_ROW])
    const appts = await listAppointmentsByProfessionalId('org-1', 'pro-1')
    expect(appts).toHaveLength(1)
    expect(appts[0]).toMatchObject({
      id: 'apt-1',
      professionalId: 'pro-1',
      status: 'scheduled',
      unitId: 'u1',
    })
  })

  it('returns empty when the professional has none', async () => {
    mocks.readUnderRls.mockResolvedValue([])
    expect(await listAppointmentsByProfessionalId('org-1', 'pro-1')).toHaveLength(0)
  })
})
