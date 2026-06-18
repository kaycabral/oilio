import { MeShell } from '@/components/me-shell'
import { getSessionUser } from '@/shared/firebase/admin'
import { isFirebaseConfigured } from '@/shared/firebase/config'
import { redirect } from 'next/navigation'

// Customer self-service area (`/me/*`). Identity is the global User — no org
// membership required (unlike `(app)/`), so this layout only gates on an
// authenticated session and wraps the pages in the customer shell.
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
