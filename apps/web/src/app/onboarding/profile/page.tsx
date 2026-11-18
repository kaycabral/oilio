import { attributionToSearchParams } from '@/domain'
import { deriveProfilePrefill } from '@/features/onboarding/core/profile-form'
import { resolveSignupOrgContext } from '@/features/onboarding/core/signup-context'
import { CompleteProfileForm } from '@/features/onboarding/ui/CompleteProfileForm'
import { getUserById } from '@/shared/db/pg/users-store'
import { getSessionUser } from '@/shared/firebase/admin'
import { isFirebaseConfigured } from '@/shared/firebase/config'
import { safeNext } from '@/shared/routes'
import { Typography } from '@oilio/design'
import { redirect } from 'next/navigation'

type SearchParams = Promise<{ next?: string }>

export default async function CompleteProfilePage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  if (!isFirebaseConfigured()) redirect('/')

  const session = await getSessionUser()
  if (!session) redirect('/login')

  const user = await getUserById(session.uid)
  if (user?.completionCompleted) {
    const { next } = await searchParams
    redirect(safeNext(next))
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
      <CompleteProfileForm prefill={prefill} next={safeNext(next)} contextQuery={contextQuery} />
    </div>
  )
}
