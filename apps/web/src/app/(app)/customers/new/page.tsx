import { Breadcrumbs } from '@/components/breadcrumbs'
import { CustomerForm } from '@/features/customers/ui/CustomerForm'
import { getSessionUser } from '@/shared/firebase/admin'
import { getActiveTenantContext } from '@/shared/tenant/membership'
import { Main } from '@cbrl/design'
import { redirect } from 'next/navigation'

export default async function NewCustomerPage() {
  const session = await getSessionUser()
  if (!session) redirect('/login')
  const ctx = await getActiveTenantContext(session.uid)
  if (!ctx) redirect('/onboarding')

  return (
    <Main width="narrow" className="space-y-4">
      <Breadcrumbs
        crumbs={[
          { label: 'Clientes', href: '/customers' },
          { label: 'Novo', href: null },
        ]}
      />
      <h1 className="text-2xl font-semibold">Novo cliente</h1>
      <CustomerForm />
    </Main>
  )
}
