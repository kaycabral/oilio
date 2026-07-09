import { describe, expect, it } from 'vitest'
import {
  parseAppointmentForm,
  readAppointmentId,
  resolveStartEnd,
  type ParsedAppointment,
  type SlotInput,
} from './appointment-form'

function form(fields: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  return fd
}

function asParsed(r: ParsedAppointment | string): ParsedAppointment {
  if (typeof r === 'string') throw new Error(`expected a parsed appointment, got: ${r}`)
  return r
}

const BASE = {
  unitId: 'u1',
  memberOperationId: 'p1',
  serviceId: 's1',
  date: '2026-06-15',
  startTime: '10:00',
}

describe('parseAppointmentForm', () => {
  it('parses an existing-customer booking', () => {
    expect(
      parseAppointmentForm(form({ ...BASE, customerMode: 'existing', customerId: 'c1' })),
    ).toEqual({
      unitId: 'u1',
      memberOperationId: 'p1',
      serviceId: 's1',
      customerId: 'c1',
      newCustomer: null,
      date: '2026-06-15',
      startTime: '10:00',
    })
  })

  it('parses a new-customer booking', () => {
    const r = parseAppointmentForm(
      form({
        ...BASE,
        customerMode: 'new',
        newCustomerName: 'Ana',
        newCustomerMobile: '5511999',
      }),
    )
    const parsed = asParsed(r)
    expect(parsed.customerId).toBeNull()
    expect(parsed.newCustomer).toEqual({ name: 'Ana', mobile: '5511999' })
  })

  it.each([
    ['unit', { unitId: '' }, 'Unidade é obrigatória'],
    ['member_operator', { memberOperationId: '' }, 'Profissional é obrigatório'],
    ['service', { serviceId: '' }, 'Serviço é obrigatório'],
    ['existing customer', { customerMode: 'existing', customerId: '' }, 'Cliente é obrigatório'],
    [
      'new customer name',
      { customerMode: 'new', newCustomerName: 'A' },
      'Nome do cliente é obrigatório',
    ],
    ['date', { customerId: 'c1', date: '15/06' }, 'Data inválida'],
    ['time', { customerId: 'c1', startTime: '10h' }, 'Horário inválido'],
  ])('rejects bad %s', (_label, override, message) => {
    expect(parseAppointmentForm(form({ ...BASE, customerId: 'c1', ...override }))).toBe(message)
  })

  it('rejects a new customer without whatsapp', () => {
    expect(
      parseAppointmentForm(
        form({ ...BASE, customerMode: 'new', newCustomerName: 'Ana', newCustomerMobile: '' }),
      ),
    ).toBe('WhatsApp do cliente é obrigatório')
  })
})

describe('resolveStartEnd', () => {
  const slot: SlotInput = { ...BASE }

  it('computes endAt as startAt + duration', () => {
    const r = resolveStartEnd({ timezone: 'America/Sao_Paulo' }, slot, 30)
    expect(typeof r).toBe('object')
    if (typeof r === 'object') {
      const delta = new Date(r.endAt).getTime() - new Date(r.startAt).getTime()
      expect(delta).toBe(30 * 60_000)
      expect(r.startAt).toBe('2026-06-15T13:00:00.000Z')
    }
  })

  it('rejects a malformed start time', () => {
    expect(
      resolveStartEnd({ timezone: 'America/Sao_Paulo' }, { ...slot, startTime: '10' }, 30),
    ).toBe('Horário inválido')
  })
})

describe('readAppointmentId', () => {
  it('returns the id when present, null otherwise', () => {
    expect(readAppointmentId(form({ appointmentId: 'a1' }))).toBe('a1')
    expect(readAppointmentId(form({ appointmentId: '' }))).toBeNull()
    expect(readAppointmentId(form({}))).toBeNull()
  })
})
