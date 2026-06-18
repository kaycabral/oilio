'use client'

import type { CancellationPolicy } from '@/domain'
import { cancelOwnAppointment } from '@/features/me/adapters/appointments.actions'
import { Button } from '@cbrl/design'
import Link from 'next/link'
import { useState, useTransition } from 'react'

export type AppointmentRowData = {
  orgId: string
  orgSlug: string
  unitSlug: string | null
  appointmentId: string
  serviceName: string
  professionalName: string
  unitName: string
  startAtLabel: string
  endAtLabel: string
  priceLabel: string
  status: 'scheduled' | 'completed' | 'cancelled' | 'no_show'
  // Result of `canCustomerCancelAppointment` computed server-side so the
  // button reflects the same gate the action enforces.
  canCancel: boolean
  cancelReason: string | null
  cancellationPolicy: CancellationPolicy
}

export function AppointmentRow({ data }: { data: AppointmentRowData }) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [cancelled, setCancelled] = useState(data.status === 'cancelled')

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
      setCancelled(true)
    })
  }

  const effectiveStatus = cancelled ? 'cancelled' : data.status
  const rescheduleHref = data.unitSlug
    ? (`/${data.orgSlug}/${data.unitSlug}` as const)
    : (`/${data.orgSlug}` as const)

  return (
    <li className="border-border space-y-2 rounded-md border p-4">
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <p className="text-sm font-medium">{data.serviceName}</p>
          <p className="text-muted-foreground text-xs">
            {data.unitName} · {data.professionalName}
          </p>
        </div>
        <span
          className={(() => {
            if (effectiveStatus === 'cancelled') return 'text-muted-foreground text-xs'
            if (effectiveStatus === 'completed') {
              return 'rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
            }
            if (effectiveStatus === 'no_show') {
              return 'rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'
            }
            return 'rounded-full bg-sky-100 px-2 py-0.5 text-xs text-sky-700 dark:bg-sky-950/40 dark:text-sky-300'
          })()}
        >
          {statusLabel(effectiveStatus)}
        </span>
      </div>

      <p className="text-sm">
        {data.startAtLabel} → {data.endAtLabel}
      </p>
      <p className="text-muted-foreground text-xs">{data.priceLabel}</p>

      {effectiveStatus === 'scheduled' ? (
        <div className="flex flex-wrap items-center gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onCancel}
            disabled={pending || !data.canCancel}
            title={data.canCancel ? undefined : (data.cancelReason ?? undefined)}
          >
            {pending ? 'Cancelando…' : 'Cancelar'}
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link href={rescheduleHref}>Reagendar</Link>
          </Button>
          {!data.canCancel && data.cancelReason ? (
            <span className="text-muted-foreground text-xs">{data.cancelReason}</span>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p className="text-destructive border-destructive/40 bg-destructive/10 rounded-md border p-2 text-xs">
          {error}
        </p>
      ) : null}
    </li>
  )
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
