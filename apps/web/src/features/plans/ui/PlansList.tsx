'use client'

import { RowActions, type RowAction } from '@/components/RowActions'
import { StatusBadge } from '@/components/StatusBadge'
import { type BillingCycle, type SubscriptionPlan } from '@/domain'
import type { PlanStatusFilter } from '@/features/plans/adapters/load-plans'
import { deletePlan } from '@/features/plans/adapters/plans.actions'
import { PAGINATION_LABELS_PTBR } from '@/shared/list/pagination-labels'
import { useClientPagination } from '@/shared/list/use-client-pagination'
import { useListUrlControls } from '@/shared/list/use-list-url-controls'
import type { WithCanDelete } from '@/shared/org/delete-guard'
import { useCapability } from '@/shared/org/org-context'
import { toRoute } from '@/shared/routes'
import { Button, List } from '@cbrl/design'
import { CreditCard } from 'lucide-react'
import Link from 'next/link'

const CYCLE_LABELS: Record<BillingCycle, string> = {
  monthly: 'Mensal',
  quarterly: 'Trimestral',
  semiannual: 'Semestral',
  annual: 'Anual',
}

function formatPrice(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatUsage(plan: SubscriptionPlan): string {
  if (!plan.usageLimit) return '—'
  return plan.usageLimit.kind === 'unlimited' ? 'Ilimitado' : `${plan.usageLimit.quantity}/ciclo`
}

export function PlansList({
  plans,
  searchQuery,
  cycleFilter,
  statusFilter,
  canManage,
  canDelete,
  isFiltered,
}: {
  // Each row carries the precomputed active-reference flag (brief 0033, AC-03 —
  // #1068 `attachCanDelete`): `row.canDelete=false` means an active subscription
  // references it, so "Excluir" soft-deletes (archives) server-side.
  plans: WithCanDelete<SubscriptionPlan>[]
  searchQuery: string
  cycleFilter: 'all' | BillingCycle
  statusFilter: PlanStatusFilter
  canManage: boolean
  // Role gate (owner) — distinct from the per-row reference flag above.
  canDelete: boolean
  // True when data exists but the search/filter slice is empty (filtered-empty).
  isFiltered: boolean
}) {
  const { setParams } = useListUrlControls()
  const { page, pageCount, pageItems, onPageChange } = useClientPagination(plans, {
    resetKey: `${searchQuery}|${cycleFilter}|${statusFilter}`,
  })
  // Plano Oilio gate (brief 0072): recurring plans are a Pro+ capability. On Free
  // the create affordances are hidden (the createPlan server action is the real
  // wall). Combined with the role gate — both must hold to offer creation. The
  // WHOLE /plans route is 404 for a Free org (brief 0088), so this list only ever
  // renders for a Pro+ org — the tier check just guards the create button.
  const canCreatePlans = useCapability('plans.recurring')
  const showCreate = canManage && canCreatePlans

  return (
    <List
      items={pageItems}
      getKey={(p) => p.id}
      isFiltered={isFiltered}
      header={
        <header className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Planos de assinatura</h1>
          {showCreate ? (
            <Button asChild>
              <Link href={toRoute('/plans/new')}>Novo plano</Link>
            </Button>
          ) : null}
        </header>
      }
      search={{
        value: searchQuery,
        onSearch: (value) => setParams({ q: value || null }),
        placeholder: 'Buscar por nome…',
      }}
      filters={[
        {
          key: 'cycle',
          label: 'Ciclo',
          allLabel: 'Todos',
          value: cycleFilter,
          onChange: (value) => setParams({ cycle: value === 'all' ? null : value }),
          options: [
            { value: 'monthly', label: CYCLE_LABELS.monthly },
            { value: 'quarterly', label: CYCLE_LABELS.quarterly },
            { value: 'semiannual', label: CYCLE_LABELS.semiannual },
            { value: 'annual', label: CYCLE_LABELS.annual },
          ],
        },
        {
          key: 'status',
          label: 'Status',
          allLabel: 'Todos',
          value: statusFilter,
          onChange: (value) => setParams({ status: value === 'all' ? null : value }),
          options: [
            { value: 'active', label: 'Ativos' },
            { value: 'inactive', label: 'Inativos' },
          ],
        },
      ]}
      pagination={{ page, pageCount, onPageChange, labels: PAGINATION_LABELS_PTBR }}
      empty={
        // The locked (Free) surface returns its own CTA above, so here the org
        // always unlocks plans — a plain empty state that invites the first plan.
        {
          icon: <CreditCard />,
          title: 'Nenhum plano cadastrado',
          description:
            'Crie seu primeiro plano de assinatura para oferecer cobrança recorrente aos clientes.',
          ...(showCreate
            ? { actionSlot: <Link href={toRoute('/plans/new')}>Cadastrar plano</Link> }
            : {}),
        }
      }
      filteredEmpty={{ title: 'Nenhum plano para este filtro.' }}
      renderItem={(p) => {
        const actions: RowAction[] = []
        if (canManage)
          actions.push({ kind: 'link', label: 'Editar', href: toRoute(`/plans/${p.id}`) })
        if (canDelete) {
          actions.push({
            kind: 'delete',
            action: () => deletePlan(p.id),
            title: `Excluir plano "${p.name}"?`,
            description: p.canDelete
              ? 'O plano será removido em definitivo. Nenhuma assinatura ativa o referencia.'
              : 'O plano sai da oferta e novas adesões ficam bloqueadas. As assinaturas ativas permanecem até o fim do ciclo vigente e não renovam para o plano descontinuado.',
          })
        }

        return {
          icon: <CreditCard />,
          title: p.name,
          badge: (
            <StatusBadge tone={p.active ? 'success' : 'neutral'}>
              {p.active ? 'Ativo' : 'Inativo'}
            </StatusBadge>
          ),
          description: `${CYCLE_LABELS[p.billingCycle]} · ${formatUsage(p)}`,
          trailing: formatPrice(p.priceCents),
          actions: <RowActions actions={actions} label={`Ações do plano ${p.name}`} />,
        }
      }}
    />
  )
}
