'use client'

import {
  DASHBOARD_PERIODS,
  type DashboardPeriod,
  periodLabel,
} from '@/features/dashboard/core/filters'
import { Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@cbrl/design'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

export type DashboardFiltersProps = {
  selectedPeriod: DashboardPeriod
  fromDate: string
  toDate: string
}

export function DashboardFilters({ selectedPeriod, fromDate, toDate }: DashboardFiltersProps) {
  const router = useRouter()
  const [customFrom, setCustomFrom] = useState(fromDate)
  const [customTo, setCustomTo] = useState(toDate)

  function navigate(next: { period?: DashboardPeriod; from?: string; to?: string }) {
    const sp = new URLSearchParams()
    const period = next.period ?? selectedPeriod
    if (period && period !== '30d') sp.set('period', period)
    if (period === 'custom') {
      const from = next.from ?? customFrom
      const to = next.to ?? customTo
      if (from) sp.set('from', from)
      if (to) sp.set('to', to)
    }
    const qs = sp.toString()
    router.push(qs ? `/dashboard?${qs}` : '/dashboard')
  }

  return (
    <div className="flex flex-wrap items-end gap-3" aria-label="Filtros do dashboard">
      <div className="flex flex-col gap-1 text-xs">
        <Label htmlFor="dashboard-period" className="text-muted-foreground">
          Período
        </Label>
        <Select
          value={selectedPeriod}
          onValueChange={(value) => {
            const period = DASHBOARD_PERIODS.find((p) => p === value)
            if (period) navigate({ period })
          }}
        >
          <SelectTrigger id="dashboard-period">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DASHBOARD_PERIODS.map((p) => (
              <SelectItem key={p} value={p}>
                {periodLabel(p)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {selectedPeriod === 'custom' ? (
        <>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground">De</span>
            <input
              type="date"
              aria-label="Data inicial"
              value={customFrom}
              max={customTo || undefined}
              onChange={(e) => {
                setCustomFrom(e.target.value)
                if (e.target.value && customTo) navigate({ from: e.target.value, to: customTo })
              }}
              className="border-input bg-background h-9 rounded-md border px-3 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground">Até</span>
            <input
              type="date"
              aria-label="Data final"
              value={customTo}
              min={customFrom || undefined}
              onChange={(e) => {
                setCustomTo(e.target.value)
                if (customFrom && e.target.value) navigate({ from: customFrom, to: e.target.value })
              }}
              className="border-input bg-background h-9 rounded-md border px-3 text-sm"
            />
          </label>
        </>
      ) : null}
    </div>
  )
}
