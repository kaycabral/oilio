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

function hhmm(t: { hour: number; minute: number }): string {
  return `${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')}`
}

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
