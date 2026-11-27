import { OnboardingForm } from '@/features/onboarding/ui/OnboardingForm'
import { getSessionUser } from '@/shared/auth/session'
import { getUserDoc, getUserMemberships } from '@/shared/org/membership'
import { isSupabaseConfigured } from '@cbrl/supabase'
import { redirect } from 'next/navigation'

export const instant = false

export default async function OnboardingPage() {
  if (!isSupabaseConfigured()) redirect('/')

  const session = await getSessionUser()
  if (!session) redirect('/login')

  const user = await getUserDoc(session.uid)
  if (!user?.completionCompleted) redirect('/onboarding/profile?next=/onboarding')

  const memberships = await getUserMemberships(session.uid)
  if (memberships.length > 0) {
    redirect('/dashboard')
  }

  return <OnboardingForm />
}
