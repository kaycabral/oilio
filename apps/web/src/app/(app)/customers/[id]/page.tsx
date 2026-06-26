import { Breadcrumbs } from '@/components/breadcrumbs'
import { loadCustomerForEdit } from '@/features/customers/adapters/load-customers'
import { CustomerForm } from '@/features/customers/ui/CustomerForm'
import { Main } from '@cbrl/design'
import { notFound } from 'next/navigation'

export default async function EditCustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const customer = await loadCustomerForEdit(id)
  if (!customer) notFound()

  return (
    <Main width="narrow" className="space-y-4">
      <Breadcrumbs
        crumbs={[
          { label: 'Clientes', href: '/customers' },
          { label: customer.name, href: null },
        ]}
      />
      <h1 className="text-2xl font-semibold">Editar cliente</h1>
      <CustomerForm customer={customer} />
    </Main>
  )
}
