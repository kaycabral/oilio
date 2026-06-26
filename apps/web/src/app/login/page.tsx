import { LoginForm } from '@/components/LoginForm'
import { isFirebaseConfigured } from '@/shared/firebase/config'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'

export default function LoginPage() {
  if (!isFirebaseConfigured()) redirect('/')

  // Centering is provided by the shared login layout (CenteredScreen) — the
  // page renders only the form.
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  )
}
