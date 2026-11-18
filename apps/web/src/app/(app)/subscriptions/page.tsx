import { loadSubscriptionsPage } from '@/features/subscriptions/adapters/load-subscriptions'
import { SubscriptionsList } from '@/features/subscriptions/ui/SubscriptionsList'
import { Main } from '@oilio/design'
import { notFound } from 'next/navigation'

export default async function SubscriptionsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>
}) {
  const { subscriptions, customers, canManage, filter, searchQuery, state, locked } =
    await loadSubscriptionsPage(await searchParams)

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
