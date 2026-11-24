'use client'

import { BirthdayIndicator } from '@/components/BirthdayIndicator'
import { RowActions, type RowAction } from '@/components/RowActions'
import { WhatsappAction } from '@/components/WhatsappAction'
import type { DeletionImpact } from '@/components/destructive/DeleteAction'
import { type Customer } from '@/domain'
import {
  deleteCustomer,
  getCustomerDeletionImpactAction,
} from '@/features/customers/adapters/customers.actions'
import { isBirthdayToday } from '@/shared/birthday'
import { PAGINATION_LABELS_PTBR } from '@/shared/list/pagination-labels'
import { useClientPagination } from '@/shared/list/use-client-pagination'
import { useListUrlControls } from '@/shared/list/use-list-url-controls'
import { toRoute } from '@/shared/routes'
import { formatBrazilPhone } from '@cbrl/br/phone'
import { Avatar, AvatarFallback, AvatarImage, List } from '@cbrl/design'
import { Users } from 'lucide-react'
import { ClientInviteDialog } from './ClientInviteDialog'

function buildImpact(c: Customer): () => Promise<DeletionImpact> {
  return async () => {
    const i = await getCustomerDeletionImpactAction(c.id)
    if ('error' in i) return { lines: [], blockedReason: i.error }

    const lines: string[] = []
    if (i.activeSubscription) {
      const due = new Date(i.activeSubscription.periodEndAt).toLocaleDateString('pt-BR')
      lines.push(`Cancelar a assinatura ${i.activeSubscription.planName} (vence em ${due})`)
    }
    if (i.futureAppointments > 0) {
      const n = i.futureAppointments
      lines.push(`Cancelar ${n} agendamento${n > 1 ? 's' : ''} futuro${n > 1 ? 's' : ''}`)
    }

    const blockedReason =
      i.openComandas > 0
        ? `Há ${i.openComandas} comanda${i.openComandas > 1 ? 's' : ''} aberta${
            i.openComandas > 1 ? 's' : ''
          }. Feche ou cancele antes de excluir.`
        : null

    return { lines, blockedReason }
  }
}

function initials(name: string): string {
  const parts = name
    .trim()
    .split(/[\s@.]+/)
    .filter(Boolean)
  const first = parts[0]?.[0] ?? ''
  const second = parts[1]?.[0] ?? ''
  return (first + second).toUpperCase() || '?'
}

export function CustomersList({
  customers,
  searchQuery,
  canDelete,
  isFiltered,
}: {
  customers: Customer[]
  searchQuery: string
  canDelete: boolean
  isFiltered: boolean
}) {
  const { setParams } = useListUrlControls()
  const { page, pageCount, pageItems, onPageChange } = useClientPagination(customers, {
    resetKey: searchQuery,
  })

  return (
    <List
      items={pageItems}
      getKey={(c) => c.id}
      isFiltered={isFiltered}
      header={
        <header className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Clientes</h1>
          <ClientInviteDialog />
        </header>
      }
      search={{
        value: searchQuery,
        onSearch: (value) => setParams({ q: value || null }),
        placeholder: 'Buscar por nome…',
      }}
      pagination={{ page, pageCount, onPageChange, labels: PAGINATION_LABELS_PTBR }}
      empty={{
        icon: <Users />,
        title: 'Nenhum cliente cadastrado',
        description:
          'Convide seu primeiro cliente: você informa o WhatsApp e ele faz o próprio cadastro pelo link.',
        actionSlot: <ClientInviteDialog />,
      }}
      filteredEmpty={{ title: 'Nenhum cliente para esta busca.' }}
      renderItem={(c) => {
        const actions: RowAction[] = [
          { kind: 'link', label: 'Ver', href: toRoute(`/customers/${c.id}`) },
        ]
        if (canDelete) {
          actions.push({
            kind: 'delete',
            action: () => deleteCustomer(c.id),
            title: `Excluir cliente "${c.name}"?`,
            description:
              'O cliente sai das listas e dos seletores. O histórico de vendas é preservado, com o nome (não é anonimização — essa é uma ação do próprio titular).',
            confirmText: c.name,
            loadImpact: buildImpact(c),
          })
        }
        return {
          leading: (
            <Avatar>
              {c.avatarUrl ? <AvatarImage src={c.avatarUrl} alt="" /> : null}
              <AvatarFallback>{initials(c.name)}</AvatarFallback>
            </Avatar>
          ),
          title:
            c.birthDate && isBirthdayToday(c.birthDate) ? (
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="truncate">{c.name}</span>
                <BirthdayIndicator />
              </span>
            ) : (
              c.name
            ),
          description: c.mobile ? formatBrazilPhone(c.mobile) : undefined,
          actions: (
            <>
              <WhatsappAction phone={c.mobile} label={`WhatsApp de ${c.name}`} />
              <RowActions actions={actions} label={`Ações de ${c.name}`} />
            </>
          ),
        }
      }}
    />
  )
}
