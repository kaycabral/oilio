import { loadSubscriptionsPage } from '@/features/subscriptions/adapters/load-subscriptions'
import { SubscriptionsList } from '@/features/subscriptions/ui/SubscriptionsList'
import { Main } from '@cbrl/design'

export default async function SubscriptionsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>
}) {
  const { subscriptions, customers, canManage, filter, searchQuery, state } =
    await loadSubscriptionsPage(await searchParams)

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
