import { User } from '@/domain'
import { CompleteProfileForm } from '@/features/onboarding/ui/CompleteProfileForm'
import { getAdminFirestore } from '@/shared/db'
import { fsConverter } from '@/shared/db/converter'
import { getSessionUser } from '@/shared/firebase/admin'
import { isFirebaseConfigured } from '@/shared/firebase/config'
import { toRoute } from '@/shared/routes'
import type { Route } from 'next'
import { redirect } from 'next/navigation'

type SearchParams = Promise<{ next?: string }>

// Post-OAuth completion step (#838). Captures the data OAuth doesn't
// give us — WhatsApp (canonical contact channel) and birthDate (powers
// "aniversariantes" and gates by min age). After save the user is sent
// to whatever route asked for completion (?next=...).
export default async function CompleteProfilePage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  if (!isFirebaseConfigured()) redirect('/')

  const session = await getSessionUser()
  if (!session) redirect('/login')

  const userSnap = await getAdminFirestore()
    .collection('users')
    .withConverter(fsConverter(User))
    .doc(session.uid)
    .get()
  const user = userSnap.data() ?? null
  // If the user already finished completion, bypass the page. Without this
  // guard a bookmarked link could let them rewrite their profile.
  if (user?.completionCompleted) {
    const { next } = await searchParams
    redirect(safeNext(next))
  }

  const { next } = await searchParams
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center p-8">
      <div className="w-full">
        <h1 className="mb-2 text-xl font-semibold">Vamos completar seu cadastro</h1>
        <p className="text-muted-foreground mb-6 text-sm">
          Precisamos do seu WhatsApp e data de nascimento para finalizar a conta.
        </p>
        <CompleteProfileForm
          defaultName={user?.displayName ?? session.displayName ?? ''}
          next={safeNext(next)}
        />
      </div>
    </main>
  )
}

function safeNext(raw: string | undefined): Route {
  if (!raw) return '/dashboard'
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/dashboard'
  return toRoute(raw)
}
