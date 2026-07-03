import { Breadcrumbs } from '@/components/breadcrumbs'
import { isCapabilityLocked } from '@/features/billing/adapters/capability-lock'
import { UpgradeCta } from '@/features/billing/ui/UpgradeGate'
import { loadCustomersAndPlans } from '@/features/subscriptions/adapters/load-subscription-form'
import { SubscriptionForm } from '@/features/subscriptions/ui/SubscriptionForm'
import { requireCapabilityPage } from '@/shared/org/membership'
import { Button, Main } from '@cbrl/design'
import Link from 'next/link'

export default async function NewSubscriptionPage() {
  // Same canonical role guard the sibling loaders use (load-subscriptions) —
  // gate by the `canManageSubscriptions` capability, never by role directly, so
  // this page stays in lockstep with the permission matrix (brief 0075).
  const ctx = await requireCapabilityPage('canManageSubscriptions', '/subscriptions')

  // Assinaturas exigem `plans.recurring` (uma assinatura consome um plano
  // recorrente). No Free, a página inteira mostra o CTA de upgrade em vez de
  // oferecer "Cadastrar plano" — que só levaria a um form negado no submit
  // (brief 0082). O `requireCapability` na action de criar plano/assinatura
  // segue sendo a parede real.
  if (await isCapabilityLocked(ctx.membership.orgId, 'plans.recurring')) {
    return (
      <Main width="narrow" className="space-y-4">
        <Breadcrumbs
          crumbs={[
            { label: 'Assinaturas', href: '/subscriptions' },
            { label: 'Nova', href: null },
          ]}
        />
        <h1 className="text-2xl font-semibold">Nova assinatura</h1>
        <UpgradeCta capability="plans.recurring" />
      </Main>
    )
  }

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
