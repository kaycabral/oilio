import { loadOrderDetailPage } from '@/features/orders/adapters/load-order-detail'
import { OrderDetail } from '@/features/orders/ui/OrderDetail'
import { Main } from '@cbrl/design'

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const props = await loadOrderDetailPage(id)
  return (
    <Main width="default">
      <OrderDetail {...props} />
    </Main>
  )
}
