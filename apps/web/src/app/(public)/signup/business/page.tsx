import { SignupBusinessForm } from '@/components/SignupBusinessForm'
import { isFirebaseConfigured } from '@/shared/firebase/config'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'

export const metadata: Metadata = {
  title: 'Criar negócio — Oilio',
  description:
    'Crie seu negócio no Oilio: agenda, assinaturas e caixa num lugar só. Comece grátis com sua conta Google.',
}

export default function SignupBusinessPage() {
  if (!isFirebaseConfigured()) redirect('/')

  return (
    <Suspense fallback={null}>
      <SignupBusinessForm />
    </Suspense>
  )
}
