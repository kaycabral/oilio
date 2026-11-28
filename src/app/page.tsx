import { Hero } from '@/components/Hero'
import { ClosingCta } from '@/components/landing/ClosingCta'
import { Features } from '@/components/landing/Features'
import { HowItWorks } from '@/components/landing/HowItWorks'
import { MultiBusiness } from '@/components/landing/MultiBusiness'
import { Verticals } from '@/components/landing/Verticals'
import { MarketingShell } from '@/components/marketing/MarketingShell'
import { SignedInRedirect } from '@/components/marketing/SignedInRedirect'
import { Suspense } from 'react'

export default function HomePage() {
  return (
    <MarketingShell>
      <Suspense fallback={null}>
        <SignedInRedirect />
      </Suspense>
      <Hero />
      <Features />
      <Verticals />
      <MultiBusiness />
      <HowItWorks />
      <ClosingCta />
    </MarketingShell>
  )
}
