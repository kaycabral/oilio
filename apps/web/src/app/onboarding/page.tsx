import { OnboardingForm } from '@/features/onboarding/ui/OnboardingForm'
import { getSessionUser } from '@/shared/firebase/admin'
import { isFirebaseConfigured } from '@/shared/firebase/config'
import { getUserDoc, getUserMemberships } from '@/shared/org/membership'
import { redirect } from 'next/navigation'

export default async function OnboardingPage() {
  if (!isFirebaseConfigured()) redirect('/')

  const session = await getSessionUser()
  if (!session) redirect('/login')

  // #838 — completion step gates everything past OAuth, including org
  // creation. Send the user to /onboarding/profile first.
  const user = await getUserDoc(session.uid)
  if (!user?.completionCompleted) redirect('/onboarding/profile?next=/onboarding')

  const memberships = await getUserMemberships(session.uid)
  if (memberships.length > 0) {
    redirect('/dashboard')
  }

  // Centering comes from the shared onboarding layout (CenteredScreen).
  return <OnboardingForm />
}
