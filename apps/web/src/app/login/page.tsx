import { LoginForm } from '@/components/LoginForm'
import { isFirebaseConfigured } from '@/shared/firebase/config'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'

export default function LoginPage() {
  if (!isFirebaseConfigured()) redirect('/')

  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  )
}
