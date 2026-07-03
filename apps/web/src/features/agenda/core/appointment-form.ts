// Pure appointment-form parsing + slot math, extracted from the `'use server'`
// actions (Functional Core / Imperative Shell) so they're importable +
// unit-tested. No I/O — the actions keep the Firestore reads, conflict checks
// and event emission.

import { fromOrgTime } from '@/domain'
import { formString } from '@/shared/form-data'

export type ParsedNewCustomer = {
  name: string
  mobile: string
}

export type ParsedAppointment = {
  unitId: string
  memberOperationId: string
  serviceId: string
  customerId: string | null
  newCustomer: ParsedNewCustomer | null
  date: string
  startTime: string
}

export type SlotInput = {
  date: string
  startTime: string
  unitId: string
  memberOperationId: string
  serviceId: string
}

export function parseAppointmentForm(formData: FormData): ParsedAppointment | string {
  const unitId = formString(formData, 'unitId').trim()
  if (!unitId) return 'Unidade é obrigatória'
  const memberOperationId = formString(formData, 'memberOperationId').trim()
  if (!memberOperationId) return 'Profissional é obrigatório'
  const serviceId = formString(formData, 'serviceId').trim()
  if (!serviceId) return 'Serviço é obrigatório'

  const customerMode = formString(formData, 'customerMode') || 'existing'
  let customerId: string | null = null
  let newCustomer: ParsedNewCustomer | null = null
  if (customerMode === 'new') {
    const name = formString(formData, 'newCustomerName').trim()
    if (name.length < 2) return 'Nome do cliente é obrigatório'
    const mobile = formString(formData, 'newCustomerMobile').trim()
    if (mobile.length === 0) return 'WhatsApp do cliente é obrigatório'
    newCustomer = { name, mobile }
  } else {
    customerId = formString(formData, 'customerId').trim()
    if (!customerId) return 'Cliente é obrigatório'
  }

  const date = formString(formData, 'date')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return 'Data inválida'
  const startTime = formString(formData, 'startTime')
  if (!/^\d{2}:\d{2}$/.test(startTime)) return 'Horário inválido'

  return { unitId, memberOperationId, serviceId, customerId, newCustomer, date, startTime }
}

export function resolveStartEnd(
  org: { timezone: string },
  parsed: SlotInput,
  durationMinutes: number,
): { startAt: string; endAt: string } | string {
  const [hh, mm] = parsed.startTime.split(':').map(Number)
  if (hh === undefined || mm === undefined) return 'Horário inválido'
  const startAt = fromOrgTime({ date: parsed.date, hour: hh, minute: mm }, org.timezone)
  const endAt = new Date(new Date(startAt).getTime() + durationMinutes * 60_000).toISOString()
  return { startAt, endAt }
}

export function readAppointmentId(formData: FormData): string | null {
  const raw = formData.get('appointmentId')
  return typeof raw === 'string' && raw.length > 0 ? raw : null
}
