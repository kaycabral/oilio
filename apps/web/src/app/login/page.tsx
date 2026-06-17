import { LoginForm } from '@/components/LoginForm'
import { isFirebaseConfigured } from '@/shared/firebase/config'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'

export default function LoginPage() {
  if (!isFirebaseConfigured()) redirect('/')

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center p-8">
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </main>
  )
}
