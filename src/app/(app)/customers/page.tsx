import { loadCustomersPage } from '@/features/customers/adapters/load-customers'
import { CustomersList } from '@/features/customers/ui/CustomersList'
import { Main } from '@cbrl/design'

export const instant = false

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const { customers, searchQuery, canDelete, state } = await loadCustomersPage(await searchParams)

  return (
    <Main width="default">
      <CustomersList
        customers={customers}
        searchQuery={searchQuery}
        canDelete={canDelete}
        isFiltered={state === 'filtered-empty'}
      />
    </Main>
  )
}
