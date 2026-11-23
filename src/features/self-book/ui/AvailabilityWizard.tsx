'use client'

import type { AvailabilityRow } from '@/domain'
import {
  loadUnitAvailability,
  type WizardAvailabilityResult,
} from '@/features/self-book/adapters/availability.actions'
import { Label } from '@cbrl/design'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

type MemberOption = { id: string; name: string }

export function AvailabilityWizard({
  slug,
  unitSlug,
  serviceId,
  serviceName,
  unitName,
  timezone,
  minDate,
  initial,
}: {
  slug: string
  unitSlug: string
  serviceId: string
  serviceName: string
  unitName: string
  timezone: string
  minDate: string
  initial: {
    date: string
    rows: AvailabilityRow[]
    memberOperations: MemberOption[]
  }
}) {
  const router = useRouter()
  const [date, setDate] = useState(initial.date)
  const [memberOperationId, setMemberOperationId] = useState<string | null>(null)
  const [rows, setRows] = useState<AvailabilityRow[]>(initial.rows)
  const [members, setMembers] = useState<MemberOption[]>(initial.memberOperations)
  const [pending, startTransition] = useTransition()

  const memberNameById = new Map(members.map((m) => [m.id, m.name]))

  function refresh(nextDate: string, nextMember: string | null): void {
    startTransition(async () => {
      const res: WizardAvailabilityResult = await loadUnitAvailability({
        slug,
        unitSlug,
        serviceId,
        date: nextDate,
        memberOperationId: nextMember,
      })
      if (res.ok) {
        setRows(res.rows)
        if (nextMember === null) setMembers(res.memberOperations)
      } else {
        setRows([])
      }
    })
  }

  function onDateChange(next: string): void {
    if (!next || next < minDate) return
    setDate(next)
    refresh(next, memberOperationId)
  }

  function onMemberChange(next: string | null): void {
    setMemberOperationId(next)
    refresh(date, next)
  }

  function goToConfirm(startAt: string, slotMemberId: string): void {
    const params = new URLSearchParams({
      service: serviceId,
      memberOperation: slotMemberId,
      start: startAt,
    })
    router.push(`/${slug}/${unitSlug}/book?${params.toString()}`)
  }

  const dateLabel = new Intl.DateTimeFormat('pt-BR', {
    timeZone: timezone,
    weekday: 'long',
    day: '2-digit',
    month: 'long',
  }).format(new Date(`${date}T12:00:00.000Z`))

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="booking-date" className="text-sm font-medium">
            Data
          </Label>
          <input
            id="booking-date"
            type="date"
            value={date}
            min={minDate}
            onChange={(e) => onDateChange(e.target.value)}
            className="border-input bg-background focus-visible:ring-ring rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none"
          />
          <span className="text-muted-foreground text-xs capitalize">{dateLabel}</span>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label className="text-sm font-medium">Profissional</Label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onMemberChange(null)}
              aria-pressed={memberOperationId === null}
              className={chipClass(memberOperationId === null)}
            >
              Qualquer um
            </button>
            {members.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => onMemberChange(m.id)}
                aria-pressed={memberOperationId === m.id}
                className={chipClass(memberOperationId === m.id)}
              >
                {m.name}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div aria-busy={pending} className={pending ? 'opacity-60' : undefined}>
        {rows.length === 0 ? (
          <p className="text-muted-foreground rounded-md border border-dashed p-6 text-center text-sm">
            Sem horários disponíveis nesta data. Escolha outro dia.
          </p>
        ) : (
          <ul className="border-border divide-border divide-y rounded-md border">
            {rows.map((r) => (
              <li key={r.localHHmm} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="text-sm font-medium tabular-nums">{r.localHHmm}</div>
                <ul className="flex flex-wrap items-center justify-end gap-2">
                  {r.slots.map((s) => {
                    const proName = memberNameById.get(s.memberOperationId) ?? 'Profissional'
                    return (
                      <li key={`${s.memberOperationId}-${s.startAt}`}>
                        <button
                          type="button"
                          onClick={() => goToConfirm(s.startAt, s.memberOperationId)}
                          aria-label={`Agendar com ${proName} às ${r.localHHmm}`}
                          className="border-border hover:bg-muted/40 rounded-md border px-2.5 py-1 text-xs"
                        >
                          {memberOperationId === null ? proName : 'Agendar'}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="text-muted-foreground text-xs">
        {serviceName} — {unitName}
      </p>
    </div>
  )
}

function chipClass(active: boolean): string {
  return active
    ? 'bg-primary text-primary-foreground rounded-full px-3 py-1 text-xs'
    : 'border-border hover:bg-muted/40 rounded-full border px-3 py-1 text-xs'
}
