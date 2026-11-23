'use client'

import {
  type AppointmentForOverlap,
  type BusinessHours,
  type CancellationPolicy,
  getBusinessHoursForDay,
  getTodayInOrgTz,
} from '@/domain'
import { filterGridByBusy, gridTimeOptions } from '@/features/agenda/core/appointment-dialog'
import {
  cancelOwnAppointment,
  loadOwnRescheduleBusy,
  rescheduleOwnAppointment,
} from '@/features/me/adapters/appointments.actions'
import {
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@cbrl/design'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState, useTransition } from 'react'

export type RescheduleConfig = {
  slotMinutes: number
  businessHours: BusinessHours | null
  timezone: string
  durationMinutes: number
}

export type AppointmentRowData = {
  orgId: string
  orgSlug: string
  unitSlug: string | null
  appointmentId: string
  serviceName: string
  memberOperationName: string
  unitName: string
  startAtLabel: string
  endAtLabel: string
  priceLabel: string
  status: 'scheduled' | 'completed' | 'cancelled' | 'no_show'
  canCancel: boolean
  cancelReason: string | null
  cancellationPolicy: CancellationPolicy
  reschedule: RescheduleConfig | null
}

function ReschedulePanel({
  data,
  config,
  onDone,
  onError,
}: {
  data: AppointmentRowData
  config: RescheduleConfig
  onDone: () => void
  onError: (message: string) => void
}) {
  const [pending, startTransition] = useTransition()
  const today = getTodayInOrgTz(config.timezone)
  const [date, setDate] = useState(today)
  const [startTime, setStartTime] = useState('')
  const [busy, setBusy] = useState<AppointmentForOverlap[]>([])

  useEffect(() => {
    let cancelled = false
    if (!date) {
      setBusy([])
      return
    }
    void loadOwnRescheduleBusy({
      orgId: data.orgId,
      appointmentId: data.appointmentId,
      date,
    }).then((res) => {
      if (!cancelled) setBusy(res.ok ? res.busy : [])
    })
    return () => {
      cancelled = true
    }
  }, [data.orgId, data.appointmentId, date])

  const timeOptions = useMemo(() => {
    if (!date) return []
    const dayHours = getBusinessHoursForDay(config.businessHours, date, config.timezone)
    const grid = gridTimeOptions(dayHours, config.slotMinutes, config.durationMinutes)
    return filterGridByBusy(grid, busy, {
      date,
      timezone: config.timezone,
      durationMinutes: config.durationMinutes,
      excludeAppointmentId: data.appointmentId,
    })
  }, [config, date, busy, data.appointmentId])

  function onConfirm() {
    onError('')
    startTransition(async () => {
      const res = await rescheduleOwnAppointment({
        orgId: data.orgId,
        appointmentId: data.appointmentId,
        date,
        startTime,
      })
      if (!res.ok) {
        onError(res.error)
        return
      }
      onDone()
    })
  }

  return (
    <div className="border-border space-y-3 rounded-md border p-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`reschedule-date-${data.appointmentId}`} className="text-xs">
            Nova data
          </Label>
          <Input
            id={`reschedule-date-${data.appointmentId}`}
            type="date"
            min={today}
            value={date}
            onChange={(e) => {
              setDate(e.target.value)
              setStartTime('')
            }}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`reschedule-time-${data.appointmentId}`} className="text-xs">
            Novo horário
          </Label>
          <Select value={startTime} onValueChange={setStartTime}>
            <SelectTrigger id={`reschedule-time-${data.appointmentId}`}>
              <SelectValue placeholder="Selecione…" />
            </SelectTrigger>
            <SelectContent>
              {timeOptions.length === 0 ? (
                <SelectItem value="__none" disabled>
                  Sem horários nesse dia
                </SelectItem>
              ) : (
                timeOptions.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        </div>
      </div>
      <Button type="button" size="sm" onClick={onConfirm} disabled={pending || !startTime}>
        {pending ? 'Reagendando…' : 'Confirmar novo horário'}
      </Button>
    </div>
  )
}

function ScheduledActions({
  data,
  onCancelled,
  onRescheduled,
}: {
  data: AppointmentRowData
  onCancelled: () => void
  onRescheduled: () => void
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [rescheduling, setRescheduling] = useState(false)
  const cancelTitle = data.canCancel ? undefined : (data.cancelReason ?? undefined)
  const rescheduleHref = data.unitSlug
    ? (`/${data.orgSlug}/${data.unitSlug}` as const)
    : (`/${data.orgSlug}` as const)

  function onCancel() {
    if (!confirm('Cancelar este agendamento?')) return
    setError(null)
    startTransition(async () => {
      const res = await cancelOwnAppointment({
        orgId: data.orgId,
        appointmentId: data.appointmentId,
      })
      if (!res.ok) {
        setError(res.error)
        return
      }
      onCancelled()
    })
  }

  return (
    <div className="space-y-2 pt-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onCancel}
          disabled={pending || !data.canCancel}
          title={cancelTitle}
        >
          {pending ? 'Cancelando…' : 'Cancelar'}
        </Button>
        {data.reschedule ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setRescheduling((v) => !v)}
            disabled={pending || !data.canCancel}
            title={cancelTitle}
          >
            {rescheduling ? 'Fechar' : 'Reagendar'}
          </Button>
        ) : (
          <Button asChild variant="ghost" size="sm">
            <Link href={rescheduleHref}>Reagendar</Link>
          </Button>
        )}
        {!data.canCancel && data.cancelReason ? (
          <span className="text-muted-foreground text-xs">{data.cancelReason}</span>
        ) : null}
      </div>

      {rescheduling && data.reschedule ? (
        <ReschedulePanel
          data={data}
          config={data.reschedule}
          onError={(m) => setError(m || null)}
          onDone={onRescheduled}
        />
      ) : null}

      {error ? (
        <p className="text-destructive border-destructive/40 bg-destructive/10 rounded-md border p-2 text-xs">
          {error}
        </p>
      ) : null}
    </div>
  )
}

export function AppointmentRow({ data }: { data: AppointmentRowData }) {
  const router = useRouter()
  const [cancelled, setCancelled] = useState(data.status === 'cancelled')
  const effectiveStatus = cancelled ? 'cancelled' : data.status

  return (
    <li className="border-border space-y-2 rounded-md border p-4">
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <p className="text-sm font-medium">{data.serviceName}</p>
          <p className="text-muted-foreground text-xs">
            {data.unitName} · {data.memberOperationName}
          </p>
        </div>
        <span className={statusBadgeClass(effectiveStatus)}>{statusLabel(effectiveStatus)}</span>
      </div>

      <p className="text-sm">
        {data.startAtLabel} → {data.endAtLabel}
      </p>
      <p className="text-muted-foreground text-xs">{data.priceLabel}</p>

      {effectiveStatus === 'scheduled' ? (
        <ScheduledActions
          data={data}
          onCancelled={() => setCancelled(true)}
          onRescheduled={() => router.refresh()}
        />
      ) : null}
    </li>
  )
}

function statusBadgeClass(s: AppointmentRowData['status']): string {
  switch (s) {
    case 'cancelled':
      return 'text-muted-foreground text-xs'
    case 'completed':
      return 'rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
    case 'no_show':
      return 'rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'
    case 'scheduled':
      return 'rounded-full bg-sky-100 px-2 py-0.5 text-xs text-sky-700 dark:bg-sky-950/40 dark:text-sky-300'
  }
}

function statusLabel(s: AppointmentRowData['status']): string {
  switch (s) {
    case 'scheduled':
      return 'Agendado'
    case 'completed':
      return 'Concluído'
    case 'cancelled':
      return 'Cancelado'
    case 'no_show':
      return 'Não compareceu'
  }
}
