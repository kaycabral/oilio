'use client'

import {
  type CashMovement,
  type CashMovementTotals,
  type PaymentMethod,
  buildCashMovementsCsv,
} from '@/domain'
import type { CashReportPeriod } from '@/features/cash/core/range'
import { formString } from '@/shared/form-data'
import { toRoute } from '@/shared/routes'
import { formatBRLFromCents, formatSignedBRLFromCents } from '@cbrl/br/money'
import { Button, Input, Label } from '@cbrl/design'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useId, useMemo, useTransition } from 'react'

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

const KIND_LABEL: Partial<Record<CashMovement['kind'], string>> = {
  sale: 'Venda',
  sale_reversal: 'Estorno de venda',
}

const PAYMENT_LABEL: Record<PaymentMethod, string> = {
  cash: 'Dinheiro',
  credit_card: 'Crédito',
  debit_card: 'Débito',
  pix: 'Pix',
}

const PAYMENT_METHODS: PaymentMethod[] = ['cash', 'credit_card', 'debit_card', 'pix']

const PERIOD_PRESETS: { value: CashReportPeriod; label: string }[] = [
  { value: 'day', label: 'Hoje' },
  { value: 'week', label: 'Semana' },
  { value: 'month', label: 'Mês' },
]

export function SalesReport({
  movements,
  totals,
  unitNameById,
  period,
  fromDate,
  toDate,
}: {
  movements: CashMovement[]
  totals: CashMovementTotals
  unitNameById: Record<string, string>
  period: CashReportPeriod
  fromDate: string
  toDate: string
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [periodPending, startPeriodTransition] = useTransition()
  const [applyPending, startApplyTransition] = useTransition()
  const fromId = useId()
  const toId = useId()

  function pushParams(next: URLSearchParams, start: typeof startPeriodTransition) {
    start(() => {
      router.push(toRoute(`${pathname}?${next.toString()}`))
    })
  }

  function goPeriod(p: CashReportPeriod) {
    const next = new URLSearchParams(searchParams.toString())
    next.set('period', p)
    next.delete('from')
    next.delete('to')
    pushParams(next, startPeriodTransition)
  }

  function applyFilters(formData: FormData) {
    const next = new URLSearchParams(searchParams.toString())
    const from = formString(formData, 'from').trim()
    const to = formString(formData, 'to').trim()
    next.set('period', 'custom')
    if (from) next.set('from', from)
    else next.delete('from')
    if (to) next.set('to', to)
    else next.delete('to')
    pushParams(next, startApplyTransition)
  }

  function handleExport() {
    const csv = buildCashMovementsCsv(movements, { unitNameById })
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `vendas_${fromDate}_${toDate}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const salesByMethodEntries = useMemo<[PaymentMethod, number][]>(
    () =>
      PAYMENT_METHODS.map((pm): [PaymentMethod, number] => [pm, totals.salesByMethod[pm]]).filter(
        ([, v]) => v > 0,
      ),
    [totals.salesByMethod],
  )

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold">Vendas</h2>
        <p className="text-muted-foreground text-sm">
          Vendas no período, no fuso da unidade. Exporte como CSV para conferência.
        </p>
      </header>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Período">
        {PERIOD_PRESETS.map((p) => (
          <Button
            key={p.value}
            type="button"
            variant={period === p.value ? 'default' : 'outline'}
            size="sm"
            disabled={periodPending}
            onClick={() => goPeriod(p.value)}
            aria-pressed={period === p.value}
          >
            {p.label}
          </Button>
        ))}
        <span
          className={`self-center text-xs ${period === 'custom' ? 'text-foreground' : 'text-muted-foreground'}`}
        >
          {period === 'custom' ? 'Personalizado' : 'ou personalize abaixo'}
        </span>
      </div>

      <form
        action={applyFilters}
        className="border-border grid gap-3 rounded-md border p-4 sm:grid-cols-3"
      >
        <div className="flex flex-col gap-1">
          <Label htmlFor={fromId} className="text-sm font-medium">
            De
          </Label>
          <Input
            id={fromId}
            type="date"
            name="from"
            defaultValue={fromDate}
            aria-label="De"
            required
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={toId} className="text-sm font-medium">
            Até
          </Label>
          <Input id={toId} type="date" name="to" defaultValue={toDate} aria-label="Até" required />
        </div>
        <div className="flex items-end justify-end gap-2">
          <Button type="submit" disabled={applyPending}>
            {applyPending ? 'Aplicando…' : 'Aplicar'}
          </Button>
          <Button type="button" variant="outline" onClick={handleExport}>
            Exportar CSV
          </Button>
        </div>
      </form>

      <section className="border-border grid gap-3 rounded-md border p-4 text-sm sm:grid-cols-3">
        <Stat label="Total de vendas" value={formatBRLFromCents(totals.totalInCents)} />
        <Stat label="Estornos" value={formatBRLFromCents(totals.totalOutCents)} />
        <Stat label="Movimentos" value={String(totals.count)} />
      </section>

      <section className="border-border space-y-2 rounded-md border p-4 text-sm">
        <div className="font-medium">Vendas por forma de pagamento</div>
        {salesByMethodEntries.length === 0 ? (
          <p className="text-muted-foreground">Nenhuma venda no período.</p>
        ) : (
          <ul className="space-y-1">
            {salesByMethodEntries.map(([pm, v]) => (
              <li key={pm} className="flex justify-between gap-2">
                <span className="text-muted-foreground">{PAYMENT_LABEL[pm]}</span>
                <span className="font-medium tabular-nums">{formatBRLFromCents(v)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="text-base font-semibold">Movimentos ({movements.length})</h3>
        {movements.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nenhuma venda no período.</p>
        ) : (
          <div className="border-border overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/30">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Data</th>
                  <th className="px-3 py-2 text-left font-medium">Tipo</th>
                  <th className="px-3 py-2 text-left font-medium">Forma</th>
                  <th className="px-3 py-2 text-right font-medium">Valor</th>
                </tr>
              </thead>
              <tbody className="divide-border divide-y">
                {movements.map((m) => {
                  const detail = m.paymentMethod ? PAYMENT_LABEL[m.paymentMethod] : '—'
                  return (
                    <tr key={m.id}>
                      <td className="px-3 py-2">{formatDateTime(m.createdAt)}</td>
                      <td className="px-3 py-2">{KIND_LABEL[m.kind] ?? m.kind}</td>
                      <td className="text-muted-foreground px-3 py-2">{detail}</td>
                      <td
                        className={`px-3 py-2 text-right font-medium tabular-nums ${
                          m.direction === 'in'
                            ? 'text-emerald-700 dark:text-emerald-300'
                            : 'text-destructive'
                        }`}
                      >
                        {formatSignedBRLFromCents(
                          m.direction === 'in' ? m.amountCents : -m.amountCents,
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  )
}
