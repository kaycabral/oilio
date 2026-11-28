import { loadOrderDetailPage } from '@/features/orders/adapters/load-order-detail'
import { OrderDetail } from '@/features/orders/ui/OrderDetail'
import { Main } from '@cbrl/design'
import { connection } from 'next/server'

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  await connection()
  const { id } = await params
  const props = await loadOrderDetailPage(id)
  return (
    <Main width="default">
      <OrderDetail {...props} />
    </Main>
  )
}
