import { MeShell } from '@/components/me-shell'
import { getSessionUser } from '@/shared/firebase/admin'
import { isFirebaseConfigured } from '@/shared/firebase/config'
import { listLinkedOrgIds } from '@/shared/identity/org-links'
import { redirect } from 'next/navigation'

export default async function MeLayout({ children }: { children: React.ReactNode }) {
  if (!isFirebaseConfigured()) redirect('/')

  const session = await getSessionUser()
  if (!session) redirect('/login')

  const linkedOrgIds = await listLinkedOrgIds(session.uid)
  if (linkedOrgIds.length === 0) redirect('/')

  return (
    <MeShell
      user={{ name: session.displayName, secondary: session.email, avatarUrl: session.picture }}
    >
      {children}
    </MeShell>
  )
}
