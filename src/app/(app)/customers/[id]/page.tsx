import { Breadcrumbs } from '@/components/breadcrumbs'
import { loadCustomerForView } from '@/features/customers/adapters/load-customers'
import { CustomerDetail } from '@/features/customers/ui/CustomerDetail'
import { Main } from '@cbrl/design'
import { notFound } from 'next/navigation'
import { connection } from 'next/server'

export const instant = false

export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await connection()
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
