import { Hero } from '@/components/Hero'
import { getSessionUser } from '@/shared/firebase/admin'
import { isFirebaseConfigured } from '@/shared/firebase/config'
import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default async function HomePage() {
  // Usuário autenticado não pode cair na landing pública (Hero) — é o que
  // acontecia após o onboarding (`createTenant` faz `redirect('/')`), deixando
  // o usuário "preso na tela de entrar". Manda pro app; o gate do
  // `(app)/layout` resolve daqui (sem tenant → /onboarding, completion
  // pendente → /onboarding/profile). Visitante deslogado vê o Hero.
  if (isFirebaseConfigured()) {
    const session = await getSessionUser()
    if (session) redirect('/dashboard')
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col items-center justify-center p-8">
      <Hero />
    </main>
  )
}
