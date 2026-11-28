import { MeShell } from '@/components/me-shell'
import { getSessionUser } from '@/shared/auth/session'
import { listLinkedOrgIds } from '@/shared/identity/org-links'
import { isSupabaseConfigured } from '@cbrl/supabase'
import { redirect } from 'next/navigation'
import { connection } from 'next/server'
import { Suspense } from 'react'

export default function MeLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={null}>
      <SignedInMe>{children}</SignedInMe>
    </Suspense>
  )
}

async function SignedInMe({ children }: { children: React.ReactNode }) {
  await connection()
  if (!isSupabaseConfigured()) redirect('/')

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
