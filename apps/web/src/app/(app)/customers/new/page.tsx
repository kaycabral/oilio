import { Breadcrumbs } from '@/components/breadcrumbs'
import { ClientInviteForm } from '@/features/customers/ui/ClientInviteForm'
import { getSessionUser } from '@/shared/firebase/admin'
import { getActiveOrgContext } from '@/shared/org/membership'
import { Main } from '@cbrl/design'
import { redirect } from 'next/navigation'

// "Novo cliente" is now a CONVITE surface (brief 0077, Grupo B — #1279): the
// establishment stops typing customer PII and instead hands out a contextual
// link. The customer materializes their own account (login → complete), which
// kills the wrong-number ghost at the source.
export default async function NewCustomerPage() {
  const session = await getSessionUser()
  if (!session) redirect('/login')
  const ctx = await getActiveOrgContext(session.uid)
  if (!ctx) redirect('/onboarding')

  return (
    <Main width="narrow" className="space-y-4">
      <Breadcrumbs
        crumbs={[
          { label: 'Clientes', href: '/customers' },
          { label: 'Convidar', href: null },
        ]}
      />
      <h1 className="text-2xl font-semibold">Convidar cliente</h1>
      <p className="text-muted-foreground text-sm">
        Informe o WhatsApp do cliente e envie o convite. Ele faz o próprio cadastro pelo link — você
        não digita os dados dele.
      </p>
      <ClientInviteForm />
    </Main>
  )
}
