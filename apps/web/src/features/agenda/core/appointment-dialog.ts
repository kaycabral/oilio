// Pure derivations for the appointment dialog, extracted from the 'use client'
// component (Functional Core / Imperative Shell) so the WhatsApp deep-link
// build and the initial date/time resolution are importable + unit-tested. No
// React, no I/O — uses only the pure shared timezone/template helpers.

import {
  type Appointment,
  type AppointmentForOverlap,
  type CatalogServiceItem,
  type Customer,
  type HoursRange,
  type MemberOperation,
  buildWhatsappLink,
  fromOrgTime,
  hhmmToMinutes,
  intervalsOverlap,
  minutesToHHmm,
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
    | Pick<Appointment, 'customerId' | 'serviceId' | 'memberOperationId' | 'startAt'>
    | null
    | undefined
  customers: Pick<Customer, 'id' | 'name' | 'mobile'>[]
  services: Pick<CatalogServiceItem, 'id' | 'name'>[]
  memberOperations: Pick<MemberOperation, 'id' | 'name'>[]
  timezone: string
  confirmationTemplate: string
  businessName: string
}): string | null {
  const { appointment, customers, services, memberOperations, timezone } = args
  if (!appointment) return null
  const customer = customers.find((c) => c.id === appointment.customerId)
  if (!customer) return null
  const service = services.find((s) => s.id === appointment.serviceId)
  const memberOperation = memberOperations.find((p) => p.id === appointment.memberOperationId)
  const t = toOrgTime(appointment.startAt, timezone)
  const message = renderWhatsappTemplate(args.confirmationTemplate, {
    customerName: customer.name,
    businessName: args.businessName,
    serviceName: service?.name,
    memberOperationName: memberOperation?.name,
    date: t.dateISO.split('-').reverse().join('/'),
    time: hhmm(t),
  })
  return buildWhatsappLink(customer.mobile, message)
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

// The valid grid start times (HH:mm, org-local) for a day — the same grid the
// backend enforces (brief 0080, AC-03b): each open range stepped by
// `slotMinutes`, last start such that `start + durationMinutes <= close` (the
// appointment must END within hours, mirroring availability's `close -
// duration`). Drives the reception time picker so the UI never offers an
// off-grid or overrunning `startAt`. Ascending, de-duped across ranges.
//
// `pastCutoff` (optional) drops slots whose start is already in the past for the
// given day — same rule the availability generator applies (`startMs < nowMs`,
// via `fromOrgTime`), so the picker on the current day never offers a slot the
// write path would reject as past. `nowMs` is passed in (never `Date.now()`
// here) to keep this core pure/deterministic.
export function gridTimeOptions(
  dayHours: readonly HoursRange[],
  slotMinutes: number,
  durationMinutes: number,
  pastCutoff?: { date: string; timezone: string; nowMs: number },
): string[] {
  if (slotMinutes <= 0 || durationMinutes <= 0) return []
  const minutes = new Set<number>()
  for (const range of dayHours) {
    const openMin = hhmmToMinutes(range.open)
    const closeMin = hhmmToMinutes(range.close)
    for (let m = openMin; m + durationMinutes <= closeMin; m += slotMinutes) minutes.add(m)
  }
  return Array.from(minutes)
    .sort((a, b) => a - b)
    .filter((m) => {
      if (!pastCutoff) return true
      const startMs = new Date(
        fromOrgTime(
          { date: pastCutoff.date, hour: Math.floor(m / 60), minute: m % 60 },
          pastCutoff.timezone,
        ),
      ).getTime()
      return startMs >= pastCutoff.nowMs
    })
    .map(minutesToHHmm)
}

// Drops from `grid` (HH:mm org-local starts) the slots whose [start, start +
// durationMinutes) interval overlaps an existing appointment of the selected
// professional on that day (#1318). Mirrors the public self-book omission
// (#1313): the anti-double-book invariant is per-member_operation and
// cross-unit, so `busy` MUST already be the professional's CROSS-UNIT
// appointments for the day. Half-open semantics via `intervalsOverlap`
// (back-to-back at the boundary does NOT overlap); `cancelled` is ignored;
// `excludeAppointmentId` keeps the appointment being edited so EDIT never hides
// its own current slot. Pure — `fromOrgTime` builds the UTC instants the
// comparison needs, so no `Date.now()` here.
export function filterGridByBusy(
  grid: readonly string[],
  busy: readonly AppointmentForOverlap[],
  opts: {
    date: string
    timezone: string
    durationMinutes: number
    excludeAppointmentId?: string | null
  },
): string[] {
  if (busy.length === 0 || opts.durationMinutes <= 0) return [...grid]
  const relevant = busy.filter(
    (b) =>
      b.status !== 'cancelled' &&
      !(opts.excludeAppointmentId && b.id === opts.excludeAppointmentId),
  )
  if (relevant.length === 0) return [...grid]
  return grid.filter((hhmm) => {
    const [h, m] = hhmm.split(':').map(Number)
    const startAt = fromOrgTime({ date: opts.date, hour: h ?? 0, minute: m ?? 0 }, opts.timezone)
    const endAt = new Date(
      new Date(startAt).getTime() + opts.durationMinutes * 60_000,
    ).toISOString()
    return !relevant.some((b) => intervalsOverlap({ startAt, endAt }, b))
  })
}

// The reception start-time picker's options + default, given the filtered
// `grid` (already past-cut). EDIT preserves the appointment's own start even
// when it fell off the grid (business hours changed after the booking) so the
// edit doesn't silently drop it; NEW never re-injects — if the fallback start
// landed in the past, `gridTimeOptions` already dropped it and it must not come
// back as a selectable option nor as the default (#1314). NEW defaults to the
// first grid-valid future slot, never the raw fallback.
export function resolveStartTimePicker(args: {
  grid: readonly string[]
  editMode: boolean
  initialStartTime: string
  keepInitial: boolean
}): { options: string[]; defaultValue: string | undefined } {
  const { grid, editMode, initialStartTime, keepInitial } = args
  if (editMode && keepInitial && initialStartTime && !grid.includes(initialStartTime)) {
    const options = [...grid, initialStartTime].sort((a, b) => a.localeCompare(b))
    return { options, defaultValue: initialStartTime }
  }
  const defaultValue = editMode ? initialStartTime || undefined : grid[0]
  return { options: [...grid], defaultValue }
}
