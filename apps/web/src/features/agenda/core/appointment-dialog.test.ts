import { describe, expect, it } from 'vitest'
import { buildAppointmentWhatsappLink, resolveInitialDateTime } from './appointment-dialog'

const TZ = 'America/Sao_Paulo'
const apptArgs = {
  appointment: {
    customerId: 'c1',
    serviceId: 's1',
    memberOperationId: 'p1',
    startAt: '2026-06-15T13:00:00.000Z',
  },
  customers: [{ id: 'c1', name: 'Ana', whatsapp: '5511999990000' }],
  services: [{ id: 's1', name: 'Corte' }],
  memberOperations: [{ id: 'p1', name: 'Bruno' }],
  timezone: TZ,
  confirmationTemplate:
    'Oi {{customerName}}, seu {{serviceName}} com {{memberOperationName}} em {{date}} às {{time}} ({{businessName}}).',
  businessName: 'Salão X',
}

describe('buildAppointmentWhatsappLink', () => {
  it('returns null for a new appointment (none passed)', () => {
    expect(buildAppointmentWhatsappLink({ ...apptArgs, appointment: null })).toBeNull()
    expect(buildAppointmentWhatsappLink({ ...apptArgs, appointment: undefined })).toBeNull()
  })

  it('returns null when the customer no longer resolves', () => {
    expect(buildAppointmentWhatsappLink({ ...apptArgs, customers: [] })).toBeNull()
  })

  it('builds a wa.me link with the rendered confirmation message', () => {
    const link = buildAppointmentWhatsappLink(apptArgs)
    expect(link).not.toBeNull()
    expect(link).toContain('5511999990000')
    const decoded = decodeURIComponent(link!)
    expect(decoded).toContain('Ana')
    expect(decoded).toContain('Corte')
    expect(decoded).toContain('Bruno')
    expect(decoded).toContain('Salão X')
    // 13:00 UTC → 10:00 São Paulo, date dd/mm/yyyy
    expect(decoded).toContain('15/06/2026')
    expect(decoded).toContain('10:00')
  })

  it('still builds the link when service/memberOperation are missing (optional fields)', () => {
    const link = buildAppointmentWhatsappLink({ ...apptArgs, services: [], memberOperations: [] })
    expect(link).not.toBeNull()
    expect(decodeURIComponent(link!)).toContain('Ana')
  })
})

describe('resolveInitialDateTime', () => {
  it('uses the clicked date + default time for a new appointment', () => {
    expect(resolveInitialDateTime(null, '2026-07-01', '14:30', TZ)).toEqual({
      date: '2026-07-01',
      startTime: '14:30',
    })
  })

  it('falls back to 09:00 when no default time is given', () => {
    expect(resolveInitialDateTime(undefined, '2026-07-01', undefined, TZ)).toEqual({
      date: '2026-07-01',
      startTime: '09:00',
    })
  })

  it('reads the appointment start (converted to org tz) in edit mode', () => {
    expect(
      resolveInitialDateTime({ startAt: '2026-06-15T13:00:00.000Z' }, '2026-01-01', '08:00', TZ),
    ).toEqual({
      date: '2026-06-15',
      startTime: '10:00',
    })
  })
})
