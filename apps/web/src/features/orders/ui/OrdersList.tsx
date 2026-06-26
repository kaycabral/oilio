'use client'

import { RowActions } from '@/components/RowActions'
import { StatusBadge, type StatusTone } from '@/components/StatusBadge'
import type { Customer, Order, OrderStatus } from '@/domain'
import { createOrderFormAction } from '@/features/orders/adapters/orders.actions'
import { NewSaleButton } from '@/features/orders/ui/NewSaleButton'
import { PAGINATION_LABELS_PTBR } from '@/shared/list/pagination-labels'
import { useClientPagination } from '@/shared/list/use-client-pagination'
import { useListUrlControls } from '@/shared/list/use-list-url-controls'
import { formatRelativeDate } from '@/shared/relative-date'
import { toRoute } from '@/shared/routes'
import { EmptyState, List } from '@cbrl/design'
import { Clock, Receipt } from 'lucide-react'
import Link from 'next/link'

import type { OrdersFilter } from '@/features/orders/adapters/load-orders'

const STATUS_LABEL: Record<OrderStatus, string> = {
  open: 'Aberta',
  closed: 'Fechada',
  cancelled: 'Cancelada',
}

const STATUS_TONE: Record<OrderStatus, StatusTone> = {
  open: 'success',
  closed: 'neutral',
  cancelled: 'danger',
}

function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function OrdersList({
  orders,
  customers,
  filter,
  searchQuery,
  isAgendaVertical,
  isFiltered,
}: {
  orders: Order[]
  customers: Record<string, Customer>
  filter: OrdersFilter
  searchQuery: string
  // Barbershop vertical also offers starting a sale from the agenda.
  isAgendaVertical: boolean
  // True when sales exist in the unit but the status/search slice is empty.
  isFiltered: boolean
}) {
  const { setParams } = useListUrlControls()
  const { page, pageCount, pageItems, onPageChange } = useClientPagination(orders, {
    resetKey: `${filter}|${searchQuery}`,
  })

  // Information hierarchy: the amount is the protagonist (trailing), then who +
  // status (title row), then when (meta) and item count (description).
  return (
    <List
      items={pageItems}
      getKey={(o) => o.id}
      isFiltered={isFiltered}
      header={
        <header className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold">Vendas</h1>
          <div className="flex items-center gap-3">
            {isAgendaVertical ? (
              <span className="text-muted-foreground hidden text-sm sm:inline">
                Ou inicie um atendimento na{' '}
                <Link href={toRoute('/agenda')} className="underline underline-offset-2">
                  Agenda
                </Link>
                .
              </span>
            ) : null}
            {/* AC-01: entrypoint de venda avulsa (appointmentId null, sem cliente). */}
            <form action={createOrderFormAction}>
              <NewSaleButton />
            </form>
          </div>
        </header>
      }
      search={{
        value: searchQuery,
        onSearch: (value) => setParams({ q: value || null }),
        placeholder: 'Buscar por cliente…',
      }}
      filters={[
        {
          key: 'status',
          label: 'Status',
          allLabel: 'Todas',
          value: filter,
          onChange: (value) => setParams({ status: value === 'all' ? null : value }),
          options: [
            { value: 'open', label: 'Abertas' },
            { value: 'closed', label: 'Fechadas' },
          ],
        },
      ]}
      pagination={{ page, pageCount, onPageChange, labels: PAGINATION_LABELS_PTBR }}
      empty={
        <div className="flex flex-col items-center gap-4">
          <EmptyState
            icon={<Receipt />}
            title="Nenhuma venda registrada"
            description="Registre a primeira venda desta unidade."
          />
          {/* The create action is a server-action form (NewSaleButton needs
              useFormStatus), so the single CTA is the form, not a link. */}
          <form action={createOrderFormAction}>
            <NewSaleButton />
          </form>
        </div>
      }
      filteredEmpty={{ title: 'Nenhuma venda para o filtro atual.' }}
      renderItem={(o) => {
        // Venda anônima (brief 0030, AC-02): sem `customerId` é uma venda avulsa
        // de balcão — distingue de "Cliente removido" (tinha cliente, doc sumiu).
        const customer = o.customerId ? customers[o.customerId] : null
        const customerLabel = o.customerId ? (customer?.name ?? 'Cliente removido') : 'Venda avulsa'
        const itemCount = o.items.length
        // The status badge already says "Fechada"/"Aberta"; the meta shows only
        // WHEN (relative, e.g. "há 2 dias") — no redundant "Fechada em" prefix.
        const isClosed = o.status === 'closed' && o.closedAt != null
        const dateIso = isClosed && o.closedAt ? o.closedAt : o.createdAt
        return {
          icon: <Receipt />,
          title: customerLabel,
          badge: <StatusBadge tone={STATUS_TONE[o.status]}>{STATUS_LABEL[o.status]}</StatusBadge>,
          description: `${itemCount} ${itemCount === 1 ? 'item' : 'itens'}`,
          meta: (
            <span
              className="inline-flex items-center gap-1"
              title={`${isClosed ? 'Fechada' : 'Aberta'} em ${formatDateTime(dateIso)}`}
            >
              <Clock className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="sr-only">{isClosed ? 'Fechada em ' : 'Aberta em '}</span>
              {formatRelativeDate(dateIso)}
            </span>
          ),
          trailing: formatBRL(o.totalCents),
          trailingHint: o.discountCents > 0 ? `desc. ${formatBRL(o.discountCents)}` : undefined,
          actions: (
            <RowActions
              label={`Ações da venda de ${customerLabel}`}
              actions={[{ kind: 'link', label: 'Ver detalhes', href: toRoute(`/orders/${o.id}`) }]}
            />
          ),
        }
      }}
    />
  )
}
