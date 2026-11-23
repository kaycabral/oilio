import { describe, expect, it } from 'vitest'
import { decideSnapshotRefresh, validateEditableCustomer } from './appointment-edit'

describe('validateEditableCustomer', () => {
  it('rejects creating a new customer during an edit', () => {
    expect(
      validateEditableCustomer({ newCustomer: { name: 'X', mobile: '11999' }, customerId: null }),
    ).toEqual({ ok: false, error: 'Cadastrar cliente novo só ao criar agendamento' })
  })

  it('rejects an edit with no customer', () => {
    expect(validateEditableCustomer({ newCustomer: null, customerId: null })).toEqual({
      ok: false,
      error: 'Cliente é obrigatório',
    })
  })

  it('accepts an existing customer and narrows the id', () => {
    expect(validateEditableCustomer({ newCustomer: null, customerId: 'cust_1' })).toEqual({
      ok: true,
      value: { customerId: 'cust_1' },
    })
  })
})

describe('decideSnapshotRefresh', () => {
  const previous = {
    serviceId: 'svc_1',
    unitId: 'unit_1',
    serviceDurationMinutesSnapshot: 30,
  }

  it('keeps the commit-time snapshot when only date/time moved', () => {
    expect(
      decideSnapshotRefresh({
        parsed: { serviceId: 'svc_1', unitId: 'unit_1' },
        previous,
        resolvedDurationMinutes: 45,
      }),
    ).toEqual({ serviceOrUnitChanged: false, effectiveDurationMinutes: 30 })
  })

  it('re-snapshots when the service changed', () => {
    expect(
      decideSnapshotRefresh({
        parsed: { serviceId: 'svc_2', unitId: 'unit_1' },
        previous,
        resolvedDurationMinutes: 45,
      }),
    ).toEqual({ serviceOrUnitChanged: true, effectiveDurationMinutes: 45 })
  })

  it('re-snapshots when the unit changed', () => {
    expect(
      decideSnapshotRefresh({
        parsed: { serviceId: 'svc_1', unitId: 'unit_2' },
        previous,
        resolvedDurationMinutes: 45,
      }),
    ).toEqual({ serviceOrUnitChanged: true, effectiveDurationMinutes: 45 })
  })
})
