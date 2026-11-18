import { loadOrdersPage } from '@/features/orders/adapters/load-orders'
import { OrdersList } from '@/features/orders/ui/OrdersList'
import { EmptyState, Main } from '@oilio/design'
import { Store } from 'lucide-react'
import Link from 'next/link'

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>
}) {
  const data = await loadOrdersPage(await searchParams)

  if (data.kind === 'no-unit') {
    return (
      <Main width="default" className="space-y-6">
        <h1 className="text-2xl font-semibold">Vendas</h1>
        <EmptyState
          icon={<Store />}
          title="Nenhuma unidade ativa"
          description="Cadastre uma unidade para registrar vendas e atendimentos."
          actionSlot={<Link href="/units/new">Cadastrar unidade</Link>}
        />
      </Main>
    )
  }

  const { filter, searchQuery, isAgendaVertical, state, orders, customers } = data

  return (
    <Main width="default">
      <OrdersList
        orders={orders}
        customers={customers}
        filter={filter}
        searchQuery={searchQuery}
        isAgendaVertical={isAgendaVertical}
        isFiltered={state === 'filtered-empty'}
      />
    </Main>
  )
}
