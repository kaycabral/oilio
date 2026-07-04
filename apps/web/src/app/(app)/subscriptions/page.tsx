import { loadSubscriptionsPage } from '@/features/subscriptions/adapters/load-subscriptions'
import { SubscriptionsList } from '@/features/subscriptions/ui/SubscriptionsList'
import { Main } from '@cbrl/design'
import { notFound } from 'next/navigation'

export default async function SubscriptionsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>
}) {
  const { subscriptions, customers, canManage, filter, searchQuery, state, locked } =
    await loadSubscriptionsPage(await searchParams)

  // Off-plan surfaces behave like routes that don't exist (brief 0088 AC-06 /
  // decisão 2026-07-03): a Free/downgraded org hitting this URL directly gets the
  // standard 404 — no dedicated locked screen, no upsell CTA (upsell lives only in
  // /settings/billing + /pricing). The loader already materialized nothing (B1).
  if (locked) notFound()

  return (
    <Main width="default">
      <SubscriptionsList
        subscriptions={subscriptions}
        customers={customers}
        canManage={canManage}
        filter={filter}
        searchQuery={searchQuery}
        isFiltered={state === 'filtered-empty'}
      />
    </Main>
  )
}
