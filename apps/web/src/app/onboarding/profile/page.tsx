import { attributionToSearchParams } from '@/domain'
import { deriveProfilePrefill } from '@/features/onboarding/core/profile-form'
import { resolveSignupOrgContext } from '@/features/onboarding/core/signup-context'
import { CompleteProfileForm } from '@/features/onboarding/ui/CompleteProfileForm'
import { getUserById } from '@/shared/db/pg/users-store'
import { getSessionUser } from '@/shared/firebase/admin'
import { isFirebaseConfigured } from '@/shared/firebase/config'
import { toRoute } from '@/shared/routes'
import { Typography } from '@cbrl/design'
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

  const user = await getUserById(session.uid)
  // If the user already finished completion, bypass the page. Without this
  // guard a bookmarked link could let them rewrite their profile.
  if (user?.completionCompleted) {
    const { next } = await searchParams
    redirect(safeNext(next))
  }

  const { next } = await searchParams

  // Progressive profiling (#1277). Pre-fill what the identity already gives us —
  // name + email from the Google OAuth profile, plus any whatsapp/birthDate a
  // returning user already has — and only ask for what's still missing. The
  // session falls back when the User doc lacks a name (fresh OAuth sign-in).
  const prefill = deriveProfilePrefill({
    name: user?.displayName ?? session.displayName,
    email: user?.email ?? session.email ?? null,
    mobile: user?.mobile ?? null,
    birthDate: user?.birthDate ?? null,
  })

  // Copy reflects whether anything is actually missing (AC-08): a returning
  // customer with everything on file just confirms; a fresh one fills the gaps.
  const intro =
    prefill.missing.length === 0
      ? 'Confira seus dados e confirme para finalizar a conta.'
      : 'Confirme seus dados — só falta o que ainda não temos.'

  // Materialize-at-completion context (#1278): the establishment + attribution
  // recovered from the return URL. Forwarded to the action as a query string so
  // it can create the Customer (intent=signup) the moment completion finishes,
  // not at the first booking. Null when this is a plain platform signup.
  const orgCtx = resolveSignupOrgContext(next)
  const contextQuery = orgCtx
    ? (() => {
        const params = attributionToSearchParams(orgCtx.attribution)
        params.set('from', orgCtx.orgSlug)
        return params.toString()
      })()
    : ''

  // Centering comes from the shared onboarding layout (CenteredScreen).
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

function safeNext(raw: string | undefined): Route {
  if (!raw) return '/dashboard'
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/dashboard'
  return toRoute(raw)
}
