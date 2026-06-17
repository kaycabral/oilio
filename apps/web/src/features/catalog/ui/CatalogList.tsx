'use client'

import { RowActions, type RowAction } from '@/components/RowActions'
import { StatusBadge } from '@/components/StatusBadge'
import type { CatalogItem, CatalogItemKind, Category } from '@/domain'
import { isCatalogService } from '@/domain'
import { deleteCatalogItem } from '@/features/catalog/adapters/catalog.actions'
import { PAGINATION_LABELS_PTBR } from '@/shared/list/pagination-labels'
import { useClientPagination } from '@/shared/list/use-client-pagination'
import { useListUrlControls } from '@/shared/list/use-list-url-controls'
import { toRoute } from '@/shared/routes'
import type { WithCanDelete } from '@/shared/tenant/delete-guard'
import { Button, List } from '@cbrl/design'
import { Handshake, Package, PackageOpen } from 'lucide-react'
import Link from 'next/link'

function formatPrice(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

// Sentinel for the category filter's "no filter" choice (Radix Select forbids an
// empty-string value); translated back to a deleted param at the boundary.
const ALL_CATEGORIES = 'all'

export function CatalogList({
  items,
  categoryLabelById,
  categories,
  kindFilter,
  categoryFilter,
  searchQuery,
  createKind,
  canManage,
  canDelete,
  isFiltered,
}: {
  // Each row carries the precomputed active-reference flag (brief 0033, AC-03 —
  // #1068 `attachCanDelete`): `row.canDelete=false` means an open order / active
  // subscription references it, so "Excluir" soft-deletes (archives).
  items: WithCanDelete<CatalogItem>[]
  // Resolves a category id to its display label. Holds only ACTIVE categories
  // (brief 0033, AC-11): an id that resolves to nothing here is archived/deleted
  // → the row shows "Sem categoria", never the raw id.
  categoryLabelById: Map<string, string>
  categories: (Category & { id: string })[]
  kindFilter: 'all' | CatalogItemKind
  categoryFilter: string
  searchQuery: string
  createKind: CatalogItemKind
  canManage: boolean
  // Role gate (owner) — distinct from the per-row reference flag above.
  canDelete: boolean
  // True when data exists but the active kind/category/search slice is empty —
  // keeps the toolbar (filtered-empty) instead of the create protagonist.
  isFiltered: boolean
}) {
  const { setParams } = useListUrlControls()
  const { page, pageCount, pageItems, onPageChange } = useClientPagination(items, {
    resetKey: `${searchQuery}|${kindFilter}|${categoryFilter}`,
  })

  return (
    <List
      items={pageItems}
      getKey={(it) => it.id}
      isFiltered={isFiltered}
      header={
        <header className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Catálogo</h1>
          {canManage ? (
            <Button asChild>
              <Link href={toRoute(`/catalog/new?kind=${createKind}`)}>Novo item</Link>
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
          key: 'kind',
          label: 'Tipo',
          allLabel: 'Todos',
          value: kindFilter,
          onChange: (value) => setParams({ kind: value === 'all' ? null : value }),
          options: [
            { value: 'service', label: 'Serviços' },
            { value: 'product', label: 'Produtos' },
          ],
        },
        {
          key: 'category',
          label: 'Categoria',
          allLabel: 'Todas',
          value: categoryFilter === '' ? ALL_CATEGORIES : categoryFilter,
          onChange: (value) => setParams({ categoryId: value === ALL_CATEGORIES ? null : value }),
          options: [
            ...categories.map((c) => ({ value: c.id, label: c.name })),
            { value: '__none', label: 'Sem categoria' },
          ],
        },
      ]}
      pagination={{ page, pageCount, onPageChange, labels: PAGINATION_LABELS_PTBR }}
      empty={{
        icon: <PackageOpen />,
        title: 'Nenhum item no catálogo',
        description:
          'Cadastre serviços e produtos em um único lugar. Use o filtro para alternar entre os tipos.',
        ...(canManage
          ? {
              actionSlot: (
                <Link href={toRoute(`/catalog/new?kind=${createKind}`)}>Cadastrar item</Link>
              ),
            }
          : {}),
      }}
      filteredEmpty={{ title: 'Nenhum item para o filtro selecionado.' }}
      renderItem={(it) => {
        const isService = isCatalogService(it)
        // Never render the raw id (brief 0033, AC-11): resolve the ACTIVE category
        // name, else "Sem categoria" for an archived/deleted one; no FK → "—".
        const categoryLabel = it.categoryId
          ? (categoryLabelById.get(it.categoryId) ?? 'Sem categoria')
          : '—'
        const detail = isCatalogService(it) ? `${it.durationMinutes} min` : `Estoque: ${it.stock}`

        const actions: RowAction[] = []
        if (canManage)
          actions.push({ kind: 'link', label: 'Editar', href: toRoute(`/catalog/${it.id}`) })
        if (canDelete) {
          actions.push({
            kind: 'delete',
            action: () => deleteCatalogItem(it.id),
            title: `Excluir "${it.name}"?`,
            description: it.canDelete
              ? 'O item será removido em definitivo. Nenhuma comanda aberta ou assinatura ativa o referencia.'
              : 'O item está em comanda aberta ou coberto por assinatura ativa. Ele sai do catálogo, mas os vínculos atuais mantêm o registro congelado.',
          })
        }

        return {
          // The icon differentiates service (Handshake — vertical-neutral) vs
          // product (Package) — the type no longer needs a text label.
          icon: isService ? <Handshake /> : <Package />,
          title: it.name,
          // Active is the norm here (archived items are already filtered out), so
          // an "Ativo" pill on every row is noise — flag only the exception.
          badge: it.active ? undefined : <StatusBadge tone="neutral">Inativo</StatusBadge>,
          // Category takes the slot the type label used to hold; detail (duration
          // / stock) follows it.
          description: categoryLabel === '—' ? detail : `${categoryLabel} · ${detail}`,
          trailing: formatPrice(it.priceCents),
          actions: <RowActions actions={actions} label={`Ações de ${it.name}`} />,
        }
      }}
    />
  )
}
