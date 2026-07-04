import { Breadcrumbs } from '@/components/breadcrumbs'
import { loadSubscriptionDetail } from '@/features/subscriptions/adapters/load-subscriptions'
import { SubscriptionDetail } from '@/features/subscriptions/ui/SubscriptionDetail'
import { Main } from '@cbrl/design'
import { notFound } from 'next/navigation'

export default async function SubscriptionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const data = await loadSubscriptionDetail(id)
  if (!data) notFound()

  // Off-plan → behave like a route that doesn't exist (brief 0088 AC-06 / decisão
  // 2026-07-03): standard 404, no locked screen. The loader materialized no
  // subscription/customer PII (B1).
  if (data.locked) notFound()

  return (
    <Main width="narrow" className="space-y-6">
      <Breadcrumbs
        crumbs={[
          { label: 'Assinaturas', href: '/subscriptions' },
          { label: data.customer?.name ?? 'Cliente removido', href: null },
        ]}
      />
      <SubscriptionDetail
        subscription={data.subscription}
        customer={data.customer}
        charges={data.charges}
        activePlans={data.activePlans}
        canManage={data.canManage}
      />
    </Main>
  )
}
