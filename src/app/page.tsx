import { Hero } from '@/components/Hero'
import { ClosingCta } from '@/components/landing/ClosingCta'
import { Features } from '@/components/landing/Features'
import { HowItWorks } from '@/components/landing/HowItWorks'
import { MultiBusiness } from '@/components/landing/MultiBusiness'
import { Verticals } from '@/components/landing/Verticals'
import { MarketingShell } from '@/components/marketing/MarketingShell'
import { getSessionUser } from '@/shared/auth/session'
import { resolvePostAuthDestination } from '@/shared/identity/post-auth-destination'
import { isSupabaseConfigured } from '@cbrl/supabase'
import { redirect } from 'next/navigation'
import { connection } from 'next/server'

export const instant = false

export default async function HomePage() {
  await connection()
  if (isSupabaseConfigured()) {
    const session = await getSessionUser()
    if (session) redirect(await resolvePostAuthDestination(session.uid))
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
