import { CenteredScreen } from '@/components/centered-screen'
import { roleLabel } from '@/domain'
import { verifyInviteToken } from '@/features/invites/adapters/invite-token'
import { checkInviteEligibility } from '@/features/invites/core/invite-acceptance'
import { AcceptInviteForm } from '@/features/invites/ui/AcceptInviteForm'
import { LogoutAndRetryButton } from '@/features/invites/ui/LogoutAndRetryButton'
import { getSessionUser } from '@/shared/firebase/admin'
import { isFirebaseConfigured } from '@/shared/firebase/config'
import { getInviteById } from '@/shared/org/invite-read'
import { getUserDoc } from '@/shared/org/membership'
import { getOrg } from '@/shared/org/org'
import { redirect } from 'next/navigation'

type Params = Promise<{ orgId: string; inviteId: string }>
type SearchParams = Promise<{ token?: string }>

export default async function AcceptInvitePage({
  params,
  searchParams,
}: {
  params: Params
  searchParams: SearchParams
}) {
  if (!isFirebaseConfigured()) redirect('/')

  const { orgId, inviteId } = await params
  const { token } = await searchParams

  if (!token) {
    return (
      <CenteredScreen>
        <h1 className="mb-2 text-xl font-semibold">Link inválido</h1>
        <p className="text-muted-foreground text-sm">O link de convite está incompleto.</p>
      </CenteredScreen>
    )
  }

  // PII (invitee email) merged from `invites_pii` on read (#1036).
  const invite = await getInviteById(orgId, inviteId)
  if (!invite) {
    return (
      <CenteredScreen>
        <h1 className="mb-2 text-xl font-semibold">Convite não encontrado</h1>
      </CenteredScreen>
    )
  }

  if (invite.status !== 'pending') {
    return (
      <CenteredScreen>
        <h1 className="mb-2 text-xl font-semibold">Convite já utilizado</h1>
        <p className="text-muted-foreground text-sm">Status: {invite.status}</p>
      </CenteredScreen>
    )
  }
  if (new Date(invite.expiresAt).getTime() < Date.now()) {
    return (
      <CenteredScreen>
        <h1 className="mb-2 text-xl font-semibold">Convite expirado</h1>
      </CenteredScreen>
    )
  }
  if (!verifyInviteToken(token, invite.tokenHash)) {
    return (
      <CenteredScreen>
        <h1 className="mb-2 text-xl font-semibold">Token inválido</h1>
      </CenteredScreen>
    )
  }

  const org = await getOrg(orgId)
  const orgName = org?.name ?? 'esta empresa'

  const session = await getSessionUser()
  if (!session) {
    const next = encodeURIComponent(`/invites/${orgId}/${inviteId}?token=${token}`)
    return (
      <CenteredScreen>
        <h1 className="mb-2 text-xl font-semibold">Convite para {orgName}</h1>
        <p className="text-muted-foreground mb-4 text-sm">
          Continue com Google usando a conta do email <strong>{invite.email}</strong>.
        </p>
        <a className="text-sm underline" href={`/login?next=${next}`}>
          Ir para login
        </a>
      </CenteredScreen>
    )
  }

  if (!checkInviteEligibility(invite, session.email ?? null).ok) {
    return (
      <CenteredScreen>
        <h1 className="mb-2 text-xl font-semibold">E-mail diferente</h1>
        <p className="text-muted-foreground mb-4 text-sm">
          Use a conta do email <strong>{invite.email}</strong>. A conta logada é{' '}
          <strong>{session.email ?? '(sem email)'}</strong>.
        </p>
        <LogoutAndRetryButton nextUrl={`/invites/${orgId}/${inviteId}?token=${token}`} />
      </CenteredScreen>
    )
  }

  // #838 — even with the correct OAuth identity, the invitee must complete
  // their profile (WhatsApp + birthDate) before consuming the invite. Send
  // them through completion with `next=` pointing back to this URL so the
  // accept-flow resumes exactly where they were.
  const user = await getUserDoc(session.uid)
  if (!user?.completionCompleted) {
    const next = encodeURIComponent(`/invites/${orgId}/${inviteId}?token=${token}`)
    redirect(`/onboarding/profile?next=${next}`)
  }

  return (
    <CenteredScreen>
      <h1 className="mb-2 text-xl font-semibold">Convite para {orgName}</h1>
      <p className="text-muted-foreground mb-4 text-sm">
        Papel proposto: <strong>{roleLabel(invite.role)}</strong>
      </p>
      <AcceptInviteForm orgId={orgId} inviteId={inviteId} token={token} />
    </CenteredScreen>
  )
}
