// Pure derivations for the appointment dialog, extracted from the 'use client'
// component (Functional Core / Imperative Shell) so the WhatsApp deep-link
// build and the initial date/time resolution are importable + unit-tested. No
// React, no I/O — uses only the pure shared timezone/template helpers.

import {
  type Appointment,
  type CatalogServiceItem,
  type Customer,
  type Professional,
  buildWhatsappLink,
  renderWhatsappTemplate,
  toOrgTime,
} from '@/domain'

// HH:mm in the org timezone from a `toOrgTime` result.
function hhmm(t: { hour: number; minute: number }): string {
  return `${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')}`
}

// Build the confirmation WhatsApp deep-link for an existing appointment, or null
// (new appointment, or the customer no longer resolves). Param types are
// narrowed to exactly what the link needs so it stays trivially testable.
export function buildAppointmentWhatsappLink(args: {
  appointment:
    | Pick<Appointment, 'customerId' | 'serviceId' | 'professionalId' | 'startAt'>
    | null
    | undefined
  customers: Pick<Customer, 'id' | 'name' | 'whatsapp'>[]
  services: Pick<CatalogServiceItem, 'id' | 'name'>[]
  professionals: Pick<Professional, 'id' | 'name'>[]
  timezone: string
  confirmationTemplate: string
  businessName: string
}): string | null {
  const { appointment, customers, services, professionals, timezone } = args
  if (!appointment) return null
  const customer = customers.find((c) => c.id === appointment.customerId)
  if (!customer) return null
  const service = services.find((s) => s.id === appointment.serviceId)
  const professional = professionals.find((p) => p.id === appointment.professionalId)
  const t = toOrgTime(appointment.startAt, timezone)
  const message = renderWhatsappTemplate(args.confirmationTemplate, {
    customerName: customer.name,
    businessName: args.businessName,
    serviceName: service?.name,
    professionalName: professional?.name,
    date: t.dateISO.split('-').reverse().join('/'),
    time: hhmm(t),
  })
  return buildWhatsappLink(customer.whatsapp, message)
}

// The date + start-time the form opens with: an edit reads them off the
// appointment (converted to org tz); a new appointment uses the clicked
// date and the default/fallback time.
export function resolveInitialDateTime(
  appointment: Pick<Appointment, 'startAt'> | null | undefined,
  date: string,
  defaultStartTime: string | undefined,
  timezone: string,
): { date: string; startTime: string } {
  if (appointment) {
    const t = toOrgTime(appointment.startAt, timezone)
    return { date: t.dateISO, startTime: hhmm(t) }
  }
  return { date, startTime: defaultStartTime ?? '09:00' }
}
