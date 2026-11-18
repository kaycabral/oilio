import { LoginForm } from '@/components/LoginForm'
import { isAuthConfigured } from '@/shared/auth/config'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'

export default function LoginPage() {
  if (!isAuthConfigured()) redirect('/')

  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  )
}
