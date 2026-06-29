'use client'

import { BirthdayIndicator } from '@/components/BirthdayIndicator'
import { RowActions, type RowAction } from '@/components/RowActions'
import { WhatsappAction } from '@/components/WhatsappAction'
import type { DeletionImpact } from '@/components/destructive/DeleteAction'
import type { Customer } from '@/domain'
import {
  deleteCustomer,
  getCustomerDeletionImpactAction,
} from '@/features/customers/adapters/customers.actions'
import { isBirthdayToday } from '@/shared/birthday'
import { PAGINATION_LABELS_PTBR } from '@/shared/list/pagination-labels'
import { useClientPagination } from '@/shared/list/use-client-pagination'
import { useListUrlControls } from '@/shared/list/use-list-url-controls'
import { toRoute } from '@/shared/routes'
import { Avatar, AvatarFallback, AvatarImage, List } from '@cbrl/design'
import { Users } from 'lucide-react'
import { ClientInviteDialog } from './ClientInviteDialog'

// Maps the server impact into the dialog's "isto vai…" list + blocker. An open
// comanda is the only hard blocker (brief 0033, AC-07); the active subscription
// and future appointments are what the cascade will cancel.
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

// Two-letter monogram for the avatar fallback when the customer has no photo.
// Mirrors the pattern in `components/user-menu.tsx`.
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
  // Role gate (owner/manager).
  canDelete: boolean
  // True when data exists but the search slice is empty (filtered-empty).
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
          'Convide seu primeiro cliente em "Convidar cliente": você informa o WhatsApp e ele faz o próprio cadastro pelo link.',
      }}
      filteredEmpty={{ title: 'Nenhum cliente para esta busca.' }}
      renderItem={(c) => {
        const actions: RowAction[] = [
          { kind: 'link', label: 'Ver', href: toRoute(`/customers/${c.id}`) },
        ]
        if (canDelete) {
          // Operator delete (brief 0033, AC-07/AC-10) — NOT LGPD. Lists what will
          // be cancelled, preserves the NAME in history; an OPEN comanda blocks.
          // High impact → type the name to confirm.
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
          // Birthday marker sits next to the name — only ON the birthday.
          title:
            c.birthDate && isBirthdayToday(c.birthDate) ? (
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="truncate">{c.name}</span>
                <BirthdayIndicator />
              </span>
            ) : (
              c.name
            ),
          // No contact line — the exposed WhatsApp action (tooltip reveals the
          // number) is the contact affordance.
          // Exposed WhatsApp shortcut beside the ⋯ menu (tooltip reveals number).
          actions: (
            <>
              <WhatsappAction phone={c.whatsapp} label={`WhatsApp de ${c.name}`} />
              <RowActions actions={actions} label={`Ações de ${c.name}`} />
            </>
          ),
        }
      }}
    />
  )
}
