'use client'

import { RowActions, type RowAction } from '@/components/RowActions'
import { StatusBadge } from '@/components/StatusBadge'
import type { CatalogItem, CatalogItemKind, Category } from '@/domain'
import { isCatalogService } from '@/domain'
import { deleteCatalogItem } from '@/features/catalog/adapters/catalog.actions'
import { PAGINATION_LABELS_PTBR } from '@/shared/list/pagination-labels'
import { useClientPagination } from '@/shared/list/use-client-pagination'
import { useListUrlControls } from '@/shared/list/use-list-url-controls'
import type { WithCanDelete } from '@/shared/org/delete-guard'
import { toRoute } from '@/shared/routes'
import { formatBRLFromCents } from '@cbrl/br/money'
import { Button, List } from '@cbrl/design'
import { Handshake, Package, PackageOpen } from 'lucide-react'
import Link from 'next/link'

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
  items: WithCanDelete<CatalogItem>[]
  categoryLabelById: Map<string, string>
  categories: (Category & { id: string })[]
  kindFilter: 'all' | CatalogItemKind
  categoryFilter: string
  searchQuery: string
  createKind: CatalogItemKind
  canManage: boolean
  canDelete: boolean
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
          icon: isService ? <Handshake /> : <Package />,
          title: it.name,
          badge: it.active ? undefined : <StatusBadge tone="neutral">Inativo</StatusBadge>,
          description: categoryLabel === '—' ? detail : `${categoryLabel} · ${detail}`,
          trailing: formatBRLFromCents(it.priceCents),
          actions: <RowActions actions={actions} label={`Ações de ${it.name}`} />,
        }
      }}
    />
  )
}
