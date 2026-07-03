import { CenteredScreen } from '@/components/centered-screen'
import { roleLabel } from '@/domain'
import { verifyInviteToken } from '@/features/invites/adapters/invite-token'
import { AcceptInviteForm } from '@/features/invites/ui/AcceptInviteForm'
import { getSessionUser } from '@/shared/firebase/admin'
import { isFirebaseConfigured } from '@/shared/firebase/config'
import { getInviteById } from '@/shared/org/invite-read'
import { getUserDoc } from '@/shared/org/membership'
import { getOrg } from '@/shared/org/org'
import { emitMemberFunnelEvent } from '@/shared/product/member-funnel-events'
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

  // PII (invitee WhatsApp) merged from `invites_pii` on read (#1036).
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

  // Funnel telemetry (brief 0084, Grupo D): the invitee opened a valid invite
  // link. PII-zero, best-effort — never traps the render.
  await emitMemberFunnelEvent({ event: 'member_invite_opened', orgId })

  const org = await getOrg(orgId)
  const orgName = org?.name ?? 'esta empresa'

  const session = await getSessionUser()
  if (!session) {
    const next = encodeURIComponent(`/invites/${orgId}/${inviteId}?token=${token}`)
    return (
      <CenteredScreen>
        <h1 className="mb-2 text-xl font-semibold">Convite para {orgName}</h1>
        <p className="text-muted-foreground mb-4 text-sm">
          Entre com sua conta Google para aceitar o convite.
        </p>
        <a className="text-sm underline" href={`/login?next=${next}`}>
          Ir para login
        </a>
      </CenteredScreen>
    )
  }

  // #838 — even when authenticated, the invitee must complete
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
