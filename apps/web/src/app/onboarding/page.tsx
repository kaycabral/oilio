import { OnboardingForm } from '@/features/onboarding/ui/OnboardingForm'
import { getSessionUser } from '@/shared/firebase/admin'
import { isFirebaseConfigured } from '@/shared/firebase/config'
import { getUserDoc, getUserMemberships } from '@/shared/tenant/membership'
import { redirect } from 'next/navigation'

export default async function OnboardingPage() {
  if (!isFirebaseConfigured()) redirect('/')

  const session = await getSessionUser()
  if (!session) redirect('/login')

  // #838 — completion step gates everything past OAuth, including tenant
  // creation. Send the user to /onboarding/profile first.
  const user = await getUserDoc(session.uid)
  if (!user?.completionCompleted) redirect('/onboarding/profile?next=/onboarding')

  const memberships = await getUserMemberships(session.uid)
  if (memberships.length > 0) {
    redirect('/dashboard')
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center p-8">
      <OnboardingForm />
    </main>
  )
}
