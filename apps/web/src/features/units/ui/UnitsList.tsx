'use client'

import { RowActions, type RowAction } from '@/components/RowActions'
import type { Unit, UnitHoursMode } from '@/domain'
import { deleteUnit } from '@/features/units/adapters/units.actions'
import { summarizeHours } from '@/features/units/core/hours-summary'
import { PAGINATION_LABELS_PTBR } from '@/shared/list/pagination-labels'
import { useClientPagination } from '@/shared/list/use-client-pagination'
import { useListUrlControls } from '@/shared/list/use-list-url-controls'
import type { WithCanDelete } from '@/shared/org/delete-guard'
import { toRoute } from '@/shared/routes'
import { Button, List } from '@cbrl/design'
import { Clock, Store } from 'lucide-react'
import Link from 'next/link'

const HOURS_MODE_LABELS: Record<UnitHoursMode, string> = {
  fixed: 'Horário fixo',
  always_open: 'Sempre aberto',
  appointment: 'Por agendamento',
}

function formatAddress(u: Unit): string {
  if (!u.address) return '—'
  const { street, number, city, state } = u.address
  return `${street}${number ? `, ${number}` : ''} — ${city}/${state}`
}

export function UnitsList({
  units,
  searchQuery,
  modeFilter,
  canManage,
  canDelete,
  isFiltered,
}: {
  // Each row carries the precomputed active-reference flag (brief 0033, AC-03 —
  // #1068 `attachCanDelete`): `row.canDelete=false` means an active professional
  // / future appointment references it, so "Excluir" soft-deletes (archives).
  units: WithCanDelete<Unit>[]
  searchQuery: string
  modeFilter: 'all' | UnitHoursMode
  canManage: boolean
  // Role gate (owner) — distinct from the per-row reference flag above.
  canDelete: boolean
  // True when data exists but the search/mode slice is empty (filtered-empty).
  isFiltered: boolean
}) {
  const { setParams } = useListUrlControls()
  const { page, pageCount, pageItems, onPageChange } = useClientPagination(units, {
    resetKey: `${searchQuery}|${modeFilter}`,
  })

  return (
    <List
      items={pageItems}
      getKey={(u) => u.id}
      isFiltered={isFiltered}
      header={
        <header className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Unidades</h1>
          {canManage ? (
            <Button asChild>
              <Link href={toRoute('/units/new')}>Nova unidade</Link>
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
          key: 'mode',
          label: 'Horário',
          allLabel: 'Todos',
          value: modeFilter,
          onChange: (value) => setParams({ mode: value === 'all' ? null : value }),
          options: [
            { value: 'fixed', label: HOURS_MODE_LABELS.fixed },
            { value: 'always_open', label: HOURS_MODE_LABELS.always_open },
            { value: 'appointment', label: HOURS_MODE_LABELS.appointment },
          ],
        },
      ]}
      pagination={{ page, pageCount, onPageChange, labels: PAGINATION_LABELS_PTBR }}
      empty={{
        icon: <Store />,
        title: 'Nenhuma unidade cadastrada',
        description:
          'Cadastre sua primeira unidade — endereço e horários — para começar a atender e publicar o agendamento.',
        actionSlot: <Link href={toRoute('/units/new')}>Cadastrar unidade</Link>,
      }}
      filteredEmpty={{ title: 'Nenhuma unidade para este filtro.' }}
      renderItem={(u) => {
        const actions: RowAction[] = []
        if (canManage)
          actions.push({ kind: 'link', label: 'Editar', href: toRoute(`/units/${u.id}`) })
        if (canDelete) {
          actions.push({
            kind: 'delete',
            action: () => deleteUnit(u.id),
            title: `Excluir unidade "${u.name}"?`,
            description: u.canDelete
              ? 'A unidade será removida em definitivo. Nenhum profissional ativo ou agendamento futuro a referencia.'
              : 'A unidade tem profissional ativo ou agendamento futuro. Ela sai das listas e dos seletores, mas o histórico é preservado.',
            confirmText: u.name,
          })
        }

        return {
          icon: <Store />,
          title: u.name,
          // Address answers "which location" (primary). The opening-hours summary
          // stays in the meta column but wraps days/time onto two lines so it
          // doesn't widen the row.
          description: formatAddress(u),
          meta: (() => {
            const hours = summarizeHours(u)
            if (!hours) return undefined
            return (
              // Icon aligns to the top (with the days line), not centered on the
              // two-line block — reads better. The clock's meaning is on hover.
              <span className="flex items-start gap-1" title="Horário de funcionamento">
                <Clock className="mt-px size-3.5 shrink-0" aria-hidden="true" />
                <span className="sr-only">Horário de funcionamento: </span>
                <span className="flex flex-col text-right leading-tight">
                  <span>{hours.days}</span>
                  {hours.time ? <span>{hours.time}</span> : null}
                </span>
              </span>
            )
          })(),
          actions: <RowActions actions={actions} label={`Ações da unidade ${u.name}`} />,
        }
      }}
    />
  )
}
