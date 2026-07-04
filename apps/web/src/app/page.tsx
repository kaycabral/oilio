import { Hero } from '@/components/Hero'
import { ClosingCta } from '@/components/landing/ClosingCta'
import { Features } from '@/components/landing/Features'
import { HowItWorks } from '@/components/landing/HowItWorks'
import { MultiBusiness } from '@/components/landing/MultiBusiness'
import { Verticals } from '@/components/landing/Verticals'
import { MarketingShell } from '@/components/marketing/MarketingShell'
import { getSessionUser } from '@/shared/firebase/admin'
import { isFirebaseConfigured } from '@/shared/firebase/config'
import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default async function HomePage() {
  // Usuário autenticado não pode cair na landing pública (Hero) — é o que
  // acontecia após o onboarding (`createOrg` faz `redirect('/')`), deixando
  // o usuário "preso na tela de entrar". Manda pro app; o gate do
  // `(app)/layout` resolve daqui (sem org → /onboarding, completion
  // pendente → /onboarding/profile). Visitante deslogado vê o Hero.
  if (isFirebaseConfigured()) {
    const session = await getSessionUser()
    if (session) redirect('/dashboard')
  }

  return (
    <MarketingShell>
      <Hero />
      <Features />
      <Verticals />
      <MultiBusiness />
      <HowItWorks />
      <ClosingCta />
    </MarketingShell>
  )
}
