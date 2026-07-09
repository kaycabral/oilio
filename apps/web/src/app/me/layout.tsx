import { MeShell } from '@/components/me-shell'
import { getSessionUser } from '@/shared/firebase/admin'
import { isFirebaseConfigured } from '@/shared/firebase/config'
import { redirect } from 'next/navigation'

export default async function MeLayout({ children }: { children: React.ReactNode }) {
  if (!isFirebaseConfigured()) redirect('/')

  const session = await getSessionUser()
  if (!session) redirect('/login')

  return (
    <MeShell
      user={{ name: session.displayName, secondary: session.email, avatarUrl: session.picture }}
    >
      {children}
    </MeShell>
  )
}
