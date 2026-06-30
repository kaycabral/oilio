'use client'

import {
  type Appointment,
  type BlockSegment,
  type CatalogServiceItem,
  type Customer,
  type HoursRange,
  type MemberOperation,
  type SlotMinutes,
  hhmmToMinutes,
  toOrgTime,
} from '@/domain'
import { cn } from '@cbrl/design'
import { useMemo } from 'react'

// MVP: range fixo 06h-22h. Slot granularity vem do org (#633).
const GRID_START_HOUR = 6
const GRID_END_HOUR = 22
const TOTAL_MINUTES = (GRID_END_HOUR - GRID_START_HOUR) * 60
// Constant vertical density across granularities: 1.067 px/min ≈ 64px por hora,
// 16px por slot de 15min. Mudar slotMinutes não estica/encolhe o grid — só muda
// onde aparecem as guides finas.
const MINUTE_PX = 16 / 15
const TOTAL_HEIGHT_PX = TOTAL_MINUTES * MINUTE_PX

function minutesFromGridStart(iso: string, dayISO: string, tz: string): number {
  const { dateISO, hour, minute } = toOrgTime(iso, tz)
  if (dateISO !== dayISO) return -1
  return hour * 60 + minute - GRID_START_HOUR * 60
}

function formatTimeLabel(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

function formatHHmm(iso: string, tz: string): string {
  const { hour, minute } = toOrgTime(iso, tz)
  return formatTimeLabel(hour, minute)
}

type Band = { top: number; height: number }

// Returns the rectangles (in px, relative to the column top) that should be
// dimmed because they fall outside the day's open ranges.
// - Not configured (hasBusinessHours=false): no bands.
// - Closed all day (no ranges && hasBusinessHours=true): one band covering the
//   entire grid — the "Fechado" label is rendered separately.
// - Open ranges (SPIKE multi-interval): shade the complement of the union of
//   ranges within the visible grid — before the first open, BETWEEN ranges
//   (lunch gap), and after the last close.
function computeOffHoursBands(dayHours: readonly HoursRange[], hasBusinessHours: boolean): Band[] {
  if (!hasBusinessHours) return []
  if (dayHours.length === 0) return [{ top: 0, height: TOTAL_HEIGHT_PX }]

  const gridStartMin = GRID_START_HOUR * 60
  const gridEndMin = GRID_END_HOUR * 60
  const clamp = (n: number) => Math.max(gridStartMin, Math.min(gridEndMin, n))
  const ranges = dayHours
    .map((r) => ({ open: clamp(hhmmToMinutes(r.open)), close: clamp(hhmmToMinutes(r.close)) }))
    .filter((r) => r.close > r.open)
    .sort((a, b) => a.open - b.open)

  const bands: Band[] = []
  let cursor = gridStartMin
  for (const r of ranges) {
    if (r.open > cursor) {
      bands.push({
        top: (cursor - gridStartMin) * MINUTE_PX,
        height: (r.open - cursor) * MINUTE_PX,
      })
    }
    cursor = Math.max(cursor, r.close)
  }
  if (cursor < gridEndMin) {
    bands.push({
      top: (cursor - gridStartMin) * MINUTE_PX,
      height: (gridEndMin - cursor) * MINUTE_PX,
    })
  }
  return bands
}

// Horizontal split for overlapping appointments (brief 0081 #1312 AC-04):
// Google-Agenda-style side-by-side. Two appointments in the same column whose
// time ranges intersect share the width; the cancelled card (toggle on) sits
// next to the active one instead of covering it.
//
// Classic interval-graph lane packing: sweep appointments in start order, assign
// each the lowest lane index free at its start, and the lane count for its
// connected overlap cluster — so a 1+1 collision splits 50/50, a lone card keeps
// the full width, and N>2 degrades gracefully (1/N each, still legible).
type SlotLane = { lane: number; lanes: number }

function computeSlotLanes(
  appts: { id: string; startMin: number; endMin: number }[],
): Map<string, SlotLane> {
  const result = new Map<string, SlotLane>()
  const ordered = [...appts].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin)

  let cluster: { id: string; startMin: number; endMin: number; lane: number }[] = []
  let clusterEnd = -1

  const flush = () => {
    if (cluster.length === 0) return
    const lanes = Math.max(...cluster.map((c) => c.lane)) + 1
    for (const c of cluster) result.set(c.id, { lane: c.lane, lanes })
    cluster = []
    clusterEnd = -1
  }

  for (const a of ordered) {
    // A gap from the running cluster max-end closes the cluster: nothing after
    // this point overlaps anything before it.
    if (a.startMin >= clusterEnd && cluster.length > 0) flush()
    const taken = new Set(cluster.filter((c) => c.endMin > a.startMin).map((c) => c.lane))
    let lane = 0
    while (taken.has(lane)) lane++
    cluster.push({ ...a, lane })
    clusterEnd = Math.max(clusterEnd, a.endMin)
  }
  flush()
  return result
}

const STATUS_STYLES: Record<Appointment['status'], string> = {
  scheduled: 'bg-primary/10 border-primary/40 text-foreground',
  completed: 'bg-emerald-500/10 border-emerald-500/40 text-emerald-900 dark:text-emerald-100',
  cancelled: 'bg-muted border-muted-foreground/30 text-muted-foreground line-through opacity-60',
  no_show: 'bg-destructive/10 border-destructive/40 text-destructive',
}

export function AgendaGrid({
  memberOperations,
  appointments,
  customersById,
  servicesById,
  date,
  timezone,
  slotMinutes,
  dayHours,
  hasBusinessHours,
  blockSegments,
  onSelectAppointment,
}: {
  memberOperations: MemberOperation[]
  appointments: Appointment[]
  customersById: Record<string, Customer>
  servicesById: Record<string, CatalogServiceItem>
  date: string
  timezone: string
  slotMinutes: SlotMinutes
  dayHours: readonly HoursRange[]
  // True when the active unit has businessHours configured. When false, the
  // overlay is suppressed (no signal yet).
  hasBusinessHours: boolean
  blockSegments: readonly BlockSegment[]
  onSelectAppointment?: (appointment: Appointment) => void
}) {
  const apptsByMemberOperation = useMemo(() => {
    const map = new Map<string, Appointment[]>()
    for (const a of appointments) {
      const arr = map.get(a.memberOperationId) ?? []
      arr.push(a)
      map.set(a.memberOperationId, arr)
    }
    return map
  }, [appointments])

  const hourLabels = useMemo(() => {
    const labels: { top: number; label: string }[] = []
    for (let h = GRID_START_HOUR; h < GRID_END_HOUR; h++) {
      labels.push({
        top: (h - GRID_START_HOUR) * 60 * MINUTE_PX,
        label: formatTimeLabel(h, 0),
      })
    }
    return labels
  }, [])

  return (
    <div className="border-border overflow-hidden rounded-md border">
      <div
        className="grid"
        style={{
          gridTemplateColumns: `64px repeat(${memberOperations.length}, minmax(180px, 1fr))`,
        }}
      >
        <div className="border-border bg-muted/30 border-r border-b" />
        {memberOperations.map((p) => (
          <div
            key={p.id}
            className="border-border bg-muted/30 flex items-center justify-between gap-2 truncate border-r border-b px-3 py-2 text-sm font-medium last:border-r-0"
            title={p.name}
          >
            <span className="truncate">{p.name}</span>
          </div>
        ))}

        <div className="relative border-r" style={{ height: TOTAL_HEIGHT_PX }}>
          {hourLabels.map((h) => (
            <div
              key={h.label}
              className="text-muted-foreground absolute -translate-y-1/2 pr-2 text-right text-xs"
              style={{ top: h.top, right: 0, left: 0 }}
            >
              {h.label}
            </div>
          ))}
        </div>

        {memberOperations.map((p) => (
          <MemberOperationColumn
            key={p.id}
            appointments={apptsByMemberOperation.get(p.id) ?? []}
            customersById={customersById}
            servicesById={servicesById}
            date={date}
            timezone={timezone}
            slotMinutes={slotMinutes}
            dayHours={dayHours}
            hasBusinessHours={hasBusinessHours}
            blockSegments={blockSegments.filter(
              (b) => b.memberOperationId === null || b.memberOperationId === p.id,
            )}
            onSelectAppointment={onSelectAppointment}
          />
        ))}
      </div>
    </div>
  )
}

function MemberOperationColumn({
  appointments,
  customersById,
  servicesById,
  date,
  timezone,
  slotMinutes,
  dayHours,
  hasBusinessHours,
  blockSegments,
  onSelectAppointment,
}: {
  appointments: Appointment[]
  customersById: Record<string, Customer>
  servicesById: Record<string, CatalogServiceItem>
  date: string
  timezone: string
  slotMinutes: SlotMinutes
  dayHours: readonly HoursRange[]
  hasBusinessHours: boolean
  blockSegments: readonly BlockSegment[]
  onSelectAppointment?: (appointment: Appointment) => void
}) {
  // Sub-hour tick lines at every slotMinutes boundary that isn't already an
  // hour line (those carry the stronger style below).
  const slotTickTops: number[] = []
  if (slotMinutes < 60) {
    for (let m = slotMinutes; m < TOTAL_MINUTES; m += slotMinutes) {
      if (m % 60 !== 0) slotTickTops.push(m * MINUTE_PX)
    }
  }

  const offHoursBands = computeOffHoursBands(dayHours, hasBusinessHours)
  const closedAllDay = hasBusinessHours && dayHours.length === 0

  // Resolve grid-relative minutes once, drop off-grid cards, then pack
  // overlapping survivors into horizontal lanes (AC-04). Memoized so the sort +
  // interval packing runs only when the column's appointments (or the day) change
  // — not on every re-render (e.g. opening/closing the appointment dialog).
  const { placed, lanes } = useMemo(() => {
    const placedCards = appointments
      .map((a) => ({
        a,
        startMin: minutesFromGridStart(a.startAt, date, timezone),
        endMin: minutesFromGridStart(a.endAt, date, timezone),
      }))
      .filter((p) => p.startMin >= 0 && p.endMin > p.startMin)
    const laneMap = computeSlotLanes(
      placedCards.map((p) => ({ id: p.a.id, startMin: p.startMin, endMin: p.endMin })),
    )
    return { placed: placedCards, lanes: laneMap }
  }, [appointments, date, timezone])

  const gridStartMin = GRID_START_HOUR * 60
  const gridEndMin = GRID_END_HOUR * 60
  const visibleBlocks = blockSegments
    .map((b) => {
      const startMin = Math.max(gridStartMin, b.startMin)
      const endMin = Math.min(gridEndMin, b.endMin)
      if (endMin <= startMin) return null
      return {
        blockId: b.blockId,
        reason: b.reason,
        top: (startMin - gridStartMin) * MINUTE_PX,
        height: (endMin - startMin) * MINUTE_PX,
      }
    })
    .filter(
      (b): b is { blockId: string; reason: string; top: number; height: number } => b !== null,
    )

  return (
    <div
      className="border-border relative border-r last:border-r-0"
      style={{ height: TOTAL_HEIGHT_PX }}
    >
      {/* Off-hours overlays — rendered before grid lines so the dim covers them
          but they still show through faintly. */}
      {offHoursBands.map((b, i) => (
        <div
          key={`off-${i}`}
          className="bg-muted/60 dark:bg-muted/40 pointer-events-none absolute right-0 left-0"
          style={{ top: b.top, height: b.height }}
        />
      ))}

      {/* Slot tick lines (sub-hour). Rendered first so hour lines paint on top. */}
      {slotTickTops.map((top) => (
        <div
          key={`slot-${top}`}
          className="border-border/20 absolute right-0 left-0 border-t"
          style={{ top }}
        />
      ))}

      {/* Hour grid lines */}
      {Array.from({ length: GRID_END_HOUR - GRID_START_HOUR }).map((_, i) => (
        <div
          key={`hour-${i}`}
          className="border-border/50 absolute right-0 left-0 border-t"
          style={{ top: i * 60 * MINUTE_PX }}
        />
      ))}

      {closedAllDay ? (
        <div className="text-muted-foreground pointer-events-none absolute inset-0 flex items-center justify-center text-xs font-medium tracking-wide uppercase">
          Fechado
        </div>
      ) : null}

      {/* Agenda blocks (lunch, absences). Rendered above off-hours and grid
          lines so they stand out, below appointments so a manual override is
          still visible if booked on top. */}
      {visibleBlocks.map((b) => (
        <div
          key={`block-${b.blockId}`}
          className="bg-muted-foreground/15 border-muted-foreground/30 text-muted-foreground absolute right-0 left-0 overflow-hidden border-y px-2 text-[10px] font-medium tracking-wide uppercase"
          style={{
            top: b.top,
            height: b.height,
            backgroundImage:
              'repeating-linear-gradient(135deg, transparent 0 6px, rgba(0,0,0,0.04) 6px 12px)',
          }}
          title={b.reason}
        >
          <span className="block truncate pt-0.5">{b.reason}</span>
        </div>
      ))}

      {placed.map(({ a, startMin, endMin }) => {
        const top = startMin * MINUTE_PX
        const height = (endMin - startMin) * MINUTE_PX
        // Lane geometry: split the column (minus the existing 4px gutters) into
        // `lanes` equal tracks. A lone card spans the full width as before.
        const { lane, lanes: laneCount } = lanes.get(a.id) ?? { lane: 0, lanes: 1 }
        const widthPct = 100 / laneCount
        const positioning =
          laneCount > 1
            ? {
                left: `calc(0.25rem + ${lane * widthPct}% )`,
                width: `calc(${widthPct}% - 0.5rem)`,
              }
            : { left: '0.25rem', right: '0.25rem' }
        const customer = customersById[a.customerId]
        const service = servicesById[a.serviceId]
        const title = `${formatHHmm(a.startAt, timezone)}–${formatHHmm(a.endAt, timezone)} · ${customer?.name ?? 'Cliente'} · ${service?.name ?? 'Serviço'}`
        const content = (
          <>
            <p className="truncate font-medium">
              {formatHHmm(a.startAt, timezone)} {customer?.name ?? 'Cliente'}
            </p>
            <p className="text-muted-foreground truncate">{service?.name ?? 'Serviço'}</p>
          </>
        )
        if (onSelectAppointment) {
          return (
            <button
              key={a.id}
              type="button"
              onClick={() => onSelectAppointment(a)}
              className={cn(
                'focus-visible:ring-ring absolute overflow-hidden rounded border px-2 py-1 text-left text-xs transition hover:brightness-95 focus:outline-none focus-visible:ring-2',
                STATUS_STYLES[a.status],
              )}
              style={{ top, height, ...positioning }}
              title={title}
            >
              {content}
            </button>
          )
        }
        return (
          <div
            key={a.id}
            className={cn(
              'absolute overflow-hidden rounded border px-2 py-1 text-xs',
              STATUS_STYLES[a.status],
            )}
            style={{ top, height, ...positioning }}
            title={title}
          >
            {content}
          </div>
        )
      })}
    </div>
  )
}
