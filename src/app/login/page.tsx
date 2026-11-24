import { LoginForm } from '@/components/LoginForm'
import { isSupabaseConfigured } from '@cbrl/supabase'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'

export default function LoginPage() {
  if (!isSupabaseConfigured()) redirect('/')

  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  )
}
