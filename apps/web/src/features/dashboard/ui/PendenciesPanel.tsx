import type { DashboardPendencies } from '@/features/dashboard/core/pendencies'
import { Card, CardContent, CardDescription, CardTitle } from '@oilio/design'
import { ArrowRight } from 'lucide-react'
import Link from 'next/link'
import { formatCents } from './KpiCard'

export type PendenciesPanelProps = {
  pendencies: DashboardPendencies
  unitsById: Record<string, string>
  customersById: Record<string, string>
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

function formatHoursOpen(h: number): string {
  if (h >= 48) return `${Math.floor(h / 24)} dias em aberto`
  return `${h}h em aberto`
}

function formatDaysInactive(d: number): string {
  return `${d} dias sem visitar`
}

export function PendenciesPanel({ pendencies, unitsById, customersById }: PendenciesPanelProps) {
  const { openOrders, inactiveCustomers } = pendencies
  const totalCount = openOrders.length + inactiveCustomers.length

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div>
          <CardDescription>Pendências</CardDescription>
          <CardTitle className="mt-1 text-lg">
            {totalCount === 0
              ? 'Nada pendente'
              : plural(totalCount, 'item para olhar', 'itens para olhar')}
          </CardTitle>
        </div>

        {totalCount === 0 ? (
          <p className="text-muted-foreground text-sm">
            Vendas em dia. Sem clientes inativos no momento.
          </p>
        ) : (
          <div className="space-y-5">
            {openOrders.length > 0 ? (
              <section aria-labelledby="pendencies-orders">
                <h3
                  id="pendencies-orders"
                  className="text-muted-foreground mb-2 text-xs font-medium tracking-wide uppercase"
                >
                  Vendas em aberto
                </h3>
                <ul className="divide-border divide-y">
                  {openOrders.map((c) => (
                    <li key={c.id}>
                      <Link
                        href={{ pathname: `/orders/${c.id}` }}
                        className="hover:bg-accent/50 -mx-2 flex items-center justify-between gap-3 rounded-md px-2 py-2 text-sm"
                      >
                        <div className="min-w-0">
                          <div className="truncate font-medium">
                            {c.customerId
                              ? (customersById[c.customerId] ?? 'Cliente desconhecido')
                              : 'Venda avulsa'}
                          </div>
                          <div className="text-muted-foreground text-xs">
                            {unitsById[c.unitId] ?? '—'} · {formatHoursOpen(c.hoursOpen)} ·{' '}
                            {formatCents(c.totalCents)}
                          </div>
                        </div>
                        <ArrowRight
                          className="text-muted-foreground h-4 w-4 shrink-0"
                          aria-hidden
                        />
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {inactiveCustomers.length > 0 ? (
              <section aria-labelledby="pendencies-customers">
                <h3
                  id="pendencies-customers"
                  className="text-muted-foreground mb-2 text-xs font-medium tracking-wide uppercase"
                >
                  Clientes inativos
                </h3>
                <ul className="divide-border divide-y">
                  {inactiveCustomers.map((c) => (
                    <li key={c.id}>
                      <Link
                        href={{ pathname: `/customers/${c.id}` }}
                        className="hover:bg-accent/50 -mx-2 flex items-center justify-between gap-3 rounded-md px-2 py-2 text-sm"
                      >
                        <div className="min-w-0">
                          <div className="truncate font-medium">{c.name}</div>
                          <div className="text-muted-foreground text-xs">
                            {formatDaysInactive(c.daysInactive)}
                          </div>
                        </div>
                        <ArrowRight
                          className="text-muted-foreground h-4 w-4 shrink-0"
                          aria-hidden
                        />
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
