import { Breadcrumbs } from '@/components/breadcrumbs'
import { loadCustomerForView } from '@/features/customers/adapters/load-customers'
import { CustomerDetail } from '@/features/customers/ui/CustomerDetail'
import { Main } from '@cbrl/design'
import { notFound } from 'next/navigation'

// Read-only customer detail (brief 0077, #1279): the establishment consults a
// customer's data but never edits it — the customer owns their data and edits it
// on their own account (#1278).
export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const customer = await loadCustomerForView(id)
  if (!customer) notFound()

  return (
    <Main width="narrow" className="space-y-4">
      <Breadcrumbs
        crumbs={[
          { label: 'Clientes', href: '/customers' },
          { label: customer.name, href: null },
        ]}
      />
      <h1 className="text-2xl font-semibold">{customer.name}</h1>
      <CustomerDetail customer={customer} />
    </Main>
  )
}
