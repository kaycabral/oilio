'use client'

import { RowActions } from '@/components/RowActions'
import type { BillingCycle, Customer, Subscription, SubscriptionStatus } from '@/domain'
import { SUBSCRIPTION_STATUS_LABEL } from '@/domain'
import type { SubscriptionsFilter } from '@/features/subscriptions/adapters/load-subscriptions'
import { PAGINATION_LABELS_PTBR } from '@/shared/list/pagination-labels'
import { useClientPagination } from '@/shared/list/use-client-pagination'
import { useListUrlControls } from '@/shared/list/use-list-url-controls'
import { formatRelativeDate } from '@/shared/relative-date'
import { toRoute } from '@/shared/routes'
import { formatBRLFromCents } from '@cbrl/br/money'
import { Badge, Button, List } from '@cbrl/design'
import { CreditCard, RotateCw } from 'lucide-react'
import Link from 'next/link'
import type { ComponentProps } from 'react'

type BadgeVariant = NonNullable<ComponentProps<typeof Badge>['variant']>

const STATUS_TONE: Record<SubscriptionStatus, BadgeVariant> = {
  active: 'success',
  past_due: 'warning',
  cancelled: 'secondary',
  cancelled_for_non_payment: 'destructive',
}

const CYCLE_LABEL: Record<BillingCycle, string> = {
  monthly: 'Mensal',
  quarterly: 'Trimestral',
  semiannual: 'Semestral',
  annual: 'Anual',
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  })
}

function StatusBadges({ s }: { s: Subscription }) {
  return (
    <span className="flex items-center gap-1.5">
      <Badge variant={STATUS_TONE[s.status]}>{SUBSCRIPTION_STATUS_LABEL[s.status]}</Badge>
      {s.cancelAtPeriodEnd && s.status !== 'cancelled' ? (
        <Badge variant="secondary">Cancela ao fim do ciclo</Badge>
      ) : null}
    </span>
  )
}

export function SubscriptionsList({
  subscriptions,
  customers,
  canManage,
  filter,
  searchQuery,
  isFiltered,
}: {
  subscriptions: Subscription[]
  customers: Record<string, Customer>
  canManage: boolean
  filter: SubscriptionsFilter
  searchQuery: string
  isFiltered: boolean
}) {
  const { setParams } = useListUrlControls()
  const { page, pageCount, pageItems, onPageChange } = useClientPagination(subscriptions, {
    resetKey: `${filter}|${searchQuery}`,
  })

  return (
    <List
      items={pageItems}
      getKey={(s) => s.id}
      isFiltered={isFiltered}
      header={
        <header className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Assinaturas</h1>
          {canManage ? (
            <Button asChild>
              <Link href={toRoute('/subscriptions/new')}>Nova assinatura</Link>
            </Button>
          ) : null}
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
            { value: 'open', label: 'Em aberto' },
            { value: 'cancelled', label: 'Encerradas' },
          ],
        },
      ]}
      pagination={{ page, pageCount, onPageChange, labels: PAGINATION_LABELS_PTBR }}
      empty={{
        icon: <CreditCard />,
        title: 'Nenhuma assinatura cadastrada',
        description: 'Crie a primeira assinatura para cobrar um cliente de forma recorrente.',
        ...(canManage
          ? { actionSlot: <Link href={toRoute('/subscriptions/new')}>Nova assinatura</Link> }
          : {}),
      }}
      filteredEmpty={{ title: 'Nenhuma assinatura para o filtro atual.' }}
      renderItem={(s) => {
        const customer = customers[s.customerId]
        const customerLabel = customer?.name ?? 'Cliente removido'
        return {
          icon: <CreditCard />,
          title: customerLabel,
          badge: <StatusBadges s={s} />,
          description: `${s.plan.name} · ${CYCLE_LABEL[s.plan.billingCycle]}`,
          meta: s.nextChargeDate ? (
            <span
              className="inline-flex items-center gap-1"
              title={`Próxima cobrança: ${formatDate(s.nextChargeDate)}`}
            >
              <RotateCw className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="sr-only">Próxima cobrança: </span>
              {formatRelativeDate(s.nextChargeDate)}
            </span>
          ) : undefined,
          trailing: formatBRLFromCents(s.plan.priceCents),
          actions: (
            <RowActions
              label={`Ações da assinatura de ${customerLabel}`}
              actions={[
                { kind: 'link', label: 'Ver detalhes', href: toRoute(`/subscriptions/${s.id}`) },
              ]}
            />
          ),
        }
      }}
    />
  )
}
