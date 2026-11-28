import { SignupBusinessForm } from '@/components/SignupBusinessForm'
import { isSupabaseConfigured } from '@cbrl/supabase'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'

export const instant = false

export const metadata: Metadata = {
  title: 'Criar negócio — Oilio',
  description:
    'Crie seu negócio no Oilio: agenda, assinaturas e caixa num lugar só. Comece grátis com sua conta Google.',
}

export default function SignupBusinessPage() {
  if (!isSupabaseConfigured()) redirect('/')

  return (
    <Suspense fallback={null}>
      <SignupBusinessForm />
    </Suspense>
  )
}
