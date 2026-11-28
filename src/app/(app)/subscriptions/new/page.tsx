import { Breadcrumbs } from '@/components/breadcrumbs'
import { isCapabilityLocked } from '@/features/billing/adapters/capability-lock'
import { loadCustomersAndPlans } from '@/features/subscriptions/adapters/load-subscription-form'
import { SubscriptionForm } from '@/features/subscriptions/ui/SubscriptionForm'
import { requireCapabilityPage } from '@/shared/org/membership'
import { Button, Main } from '@cbrl/design'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { connection } from 'next/server'

export const instant = false

export default async function NewSubscriptionPage() {
  await connection()
  const ctx = await requireCapabilityPage('canManageSubscriptions', '/subscriptions')

  if (await isCapabilityLocked(ctx.membership.orgId, 'plans.recurring')) notFound()

  const { customers, plans } = await loadCustomersAndPlans(ctx.membership.orgId)

  if (plans.length === 0) {
    return (
      <Main width="narrow" className="space-y-4">
        <Breadcrumbs
          crumbs={[
            { label: 'Assinaturas', href: '/subscriptions' },
            { label: 'Nova', href: null },
          ]}
        />
        <h1 className="text-2xl font-semibold">Nova assinatura</h1>
        <div className="border-border bg-muted/20 rounded-md border p-6 text-sm">
          <p>Nenhum plano ativo cadastrado.</p>
          <Button asChild variant="outline" className="mt-3">
            <Link href="/plans/new">Cadastrar plano</Link>
          </Button>
        </div>
      </Main>
    )
  }

  if (customers.length === 0) {
    return (
      <Main width="narrow" className="space-y-4">
        <Breadcrumbs
          crumbs={[
            { label: 'Assinaturas', href: '/subscriptions' },
            { label: 'Nova', href: null },
          ]}
        />
        <h1 className="text-2xl font-semibold">Nova assinatura</h1>
        <div className="border-border bg-muted/20 rounded-md border p-6 text-sm">
          <p>Nenhum cliente cadastrado.</p>
          <Button asChild variant="outline" className="mt-3">
            <Link href="/customers">Convidar cliente</Link>
          </Button>
        </div>
      </Main>
    )
  }

  return (
    <Main width="narrow" className="space-y-4">
      <Breadcrumbs
        crumbs={[
          { label: 'Assinaturas', href: '/subscriptions' },
          { label: 'Nova', href: null },
        ]}
      />
      <h1 className="text-2xl font-semibold">Nova assinatura</h1>
      <SubscriptionForm customers={customers} plans={plans} />
    </Main>
  )
}
