import { ClosingCta } from '@/components/landing/ClosingCta'
import { MarketingShell } from '@/components/marketing/MarketingShell'
import { PricingComparison } from '@/components/pricing/PricingComparison'
import { PricingFaq } from '@/components/pricing/PricingFaq'
import { PricingMultiBusiness } from '@/components/pricing/PricingMultiBusiness'
import { PricingTiers } from '@/components/pricing/PricingTiers'
import { getSessionUser } from '@/shared/firebase/admin'
import { isFirebaseConfigured } from '@/shared/firebase/config'
import { Typography } from '@cbrl/design'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Preços — Oilio',
  description:
    'Planos do Oilio para negócios de serviço recorrente: comece grátis e ative assinaturas, comissões e multi-unidade quando precisar.',
}

export default async function PricingPage() {
  // Mesmo gate da home: usuário autenticado não fica preso na página pública.
  if (isFirebaseConfigured()) {
    const session = await getSessionUser()
    if (session) redirect('/dashboard')
  }

  return (
    <MarketingShell>
      <section className="flex flex-col items-center gap-4 py-20 text-center sm:py-24">
        <Typography as="h1" variant="h1" className="max-w-2xl text-4xl text-balance sm:text-5xl">
          Um plano para cada estágio do seu negócio
        </Typography>
        <Typography variant="lead" className="max-w-prose">
          Comece grátis e ative assinaturas, comissões e multi-unidade conforme o seu negócio
          cresce. Sem surpresa no fim do mês.
        </Typography>
      </section>

      <PricingTiers />
      <PricingComparison />
      <PricingMultiBusiness />
      <PricingFaq />
      <ClosingCta />
    </MarketingShell>
  )
}
