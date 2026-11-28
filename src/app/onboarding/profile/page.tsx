import { attributionToSearchParams } from '@/domain'
import { deriveProfilePrefill } from '@/features/onboarding/core/profile-form'
import { resolveSignupOrgContext } from '@/features/onboarding/core/signup-context'
import { CompleteProfileForm } from '@/features/onboarding/ui/CompleteProfileForm'
import { getSessionUser } from '@/shared/auth/session'
import { getUserById } from '@/shared/db/pg/users-store'
import { toRoute } from '@/shared/routes'
import { Typography } from '@cbrl/design'
import { safeNext } from '@cbrl/next'
import { isSupabaseConfigured } from '@cbrl/supabase'
import { redirect } from 'next/navigation'
import { connection } from 'next/server'
import { Suspense } from 'react'

type SearchParams = Promise<{ next?: string }>

export default function CompleteProfilePage(
  props: Parameters<typeof CompleteProfilePageContent>[0],
) {
  return (
    <Suspense fallback={null}>
      <CompleteProfilePageContent {...props} />
    </Suspense>
  )
}

async function CompleteProfilePageContent({ searchParams }: { searchParams: SearchParams }) {
  await connection()
  if (!isSupabaseConfigured()) redirect('/')

  const session = await getSessionUser()
  if (!session) redirect('/login')

  const user = await getUserById(session.uid)
  if (user?.completionCompleted) {
    const { next } = await searchParams
    redirect(toRoute(safeNext(next, '/dashboard')))
  }

  const { next } = await searchParams

  const prefill = deriveProfilePrefill({
    name: user?.displayName ?? session.displayName,
    email: user?.email ?? session.email ?? null,
    mobile: user?.mobile ?? null,
    birthDate: user?.birthDate ?? null,
  })

  const intro =
    prefill.missing.length === 0
      ? 'Confira seus dados e confirme para finalizar a conta.'
      : 'Confirme seus dados — só falta o que ainda não temos.'

  const orgCtx = resolveSignupOrgContext(next)
  const contextQuery = orgCtx
    ? (() => {
        const params = attributionToSearchParams(orgCtx.attribution)
        params.set('from', orgCtx.orgSlug)
        return params.toString()
      })()
    : ''

  return (
    <div className="w-full">
      <Typography variant="pageTitle" className="mb-2">
        Vamos completar seu cadastro
      </Typography>
      <p className="text-muted-foreground mb-6 text-sm">{intro}</p>
      <CompleteProfileForm
        prefill={prefill}
        next={safeNext(next, '/dashboard')}
        contextQuery={contextQuery}
      />
    </div>
  )
}
