'use server'

import {
  defaultPermissionsForRole,
  inviteEmailsMatch,
  type Membership,
  membershipDocId,
} from '@/domain'
import { InviteConfig, MembershipConfig, ProfessionalConfig } from '@/domain/aggregates'
import { verifyInviteToken } from '@/features/invites/adapters/invite-token'
import { getAdminFirestore } from '@/shared/db'
import { emitEvent } from '@/shared/effect-bridge'
import { getSessionUser } from '@/shared/firebase/admin'
import { formString } from '@/shared/form-data'
import { getInviteById } from '@/shared/org/invite-read'
import { type StoredProfessional, writeProfessionalPii } from '@/shared/org/professional-read'
import { redirect } from 'next/navigation'

export type AcceptInviteResult = { ok: true; orgId: string } | { ok: false; error: string }

export async function acceptInvite(formData: FormData): Promise<AcceptInviteResult> {
  const inviteId = formString(formData, 'inviteId')
  const token = formString(formData, 'token')
  const orgId = formString(formData, 'orgId')
  if (!inviteId || !token || !orgId) {
    return { ok: false, error: 'Missing invite parameters' }
  }

  const session = await getSessionUser()
  if (!session) return { ok: false, error: 'Sign in first' }
  if (!session.emailVerified) return { ok: false, error: 'Email not verified' }

  const db = getAdminFirestore()
  // PII (invitee email) merged from `invites_pii` on read (#1036) — the email
  // match below needs it.
  const invite = await getInviteById(orgId, inviteId)
  if (!invite) return { ok: false, error: 'Invite not found' }
  if (invite.status !== 'pending') return { ok: false, error: 'Invite already used' }
  if (new Date(invite.expiresAt).getTime() < Date.now()) {
    // Event-first: a projeção do convite expirado vem do evento.
    await emitEvent(InviteConfig, `orgs/${orgId}/invites/${inviteId}`, {
      _tag: 'invite.updated',
      actorId: session.uid,
      payload: { changes: { status: 'expired' } },
    })
    return { ok: false, error: 'Invite expired' }
  }
  if (!verifyInviteToken(token, invite.tokenHash)) {
    return { ok: false, error: 'Invalid invite token' }
  }
  // Strict email match (#827): OAuth identity email must equal the invite
  // email after trim + lowercase. Anything else is a security regression.
  if (!session.email || !inviteEmailsMatch(session.email, invite.email)) {
    return {
      ok: false,
      error: `Use a conta do email ${invite.email}. A conta logada é ${session.email ?? '(sem email)'}.`,
    }
  }

  const now = new Date().toISOString()
  const membershipId = membershipDocId(invite.orgId, session.uid)
  const membership: Membership = {
    id: membershipId,
    orgId: invite.orgId,
    userId: session.uid,
    role: invite.role,
    status: 'active',
    invitedBy: invite.invitedBy,
    joinedAt: now,
    updatedAt: now,
    unitId: null,
    permissions: defaultPermissionsForRole(invite.role),
    commissionRate: null,
  }

  // Saga (event-first, sem transação única — cada aggregate seu evento): o vínculo
  // nasce de `membership.created`; quando o papel é `professional`, na sequência a
  // projeção Professional materializa via `professional.created` carregando o
  // `userId` (#1045 / brief 0028 AC-03 — fim do `userId: null`); o convite vira
  // accepted via `invite.updated`; a marca no usuário (doc de auth, não-aggregate) é
  // o último passo. Cada passo compensa os anteriores ao falhar — sem membro órfão
  // sem profissional nem vice-versa. Erro à mostra, nunca silencioso. Auditoria = stream.
  const membershipCreated = await emitEvent(MembershipConfig, `memberships/${membershipId}`, {
    _tag: 'membership.created',
    actorId: session.uid,
    payload: { data: membership },
  })
  if (!membershipCreated.ok) return { ok: false, error: membershipCreated.error }

  // Compensation for the membership step — emit the undo event AND drop the
  // projection doc (the admin-SDK delete keeps Rules out of the recovery path).
  const compensateMembership = async (): Promise<void> => {
    await emitEvent(MembershipConfig, `memberships/${membershipId}`, {
      _tag: 'membership.deleted',
      actorId: session.uid,
      payload: {},
    })
    await db
      .collection('memberships')
      .doc(membershipId)
      .delete()
      .catch(() => undefined)
  }

  // Professional materialization (only for role=professional). The projection
  // carries operational fields + the non-null `userId`; PII never enters the
  // event payload (LGPD — ADR 0010). Personal identity (name/whatsapp/email)
  // is NOT snapshotted — it derives live from `users/{userId}` at read time
  // (#1046 / AC-04/AC-05). The only per-org PII doc field is `taxIdentity`,
  // which starts null (the manager fills it in the edit form). unitIds/
  // serviceIds start empty (assigned by the manager later) and approval stays
  // `none` (derived by event in #1047) — `none` keeps the pro off the public
  // agenda until the profile is complete.
  let compensateProfessional: (() => Promise<void>) | null = null
  if (invite.role === 'professional') {
    const proRef = db.collection('orgs').doc(orgId).collection('professionals').doc()
    const stored: StoredProfessional = {
      id: proRef.id,
      orgId,
      userId: session.uid,
      operationalStatus: 'incomplete',
      defaultCommission: null,
      unitIds: [],
      serviceIds: [],
      createdAt: now,
      updatedAt: now,
    }
    await writeProfessionalPii(orgId, proRef.id, {
      taxIdentity: null,
    })
    const proCreated = await emitEvent(
      ProfessionalConfig,
      `orgs/${orgId}/professionals/${proRef.id}`,
      { _tag: 'professional.created', actorId: session.uid, payload: { data: stored } },
    )
    if (!proCreated.ok) {
      await compensateMembership()
      await proRef.delete().catch(() => undefined)
      await db
        .collection('orgs')
        .doc(orgId)
        .collection('professionals_pii')
        .doc(proRef.id)
        .delete()
        .catch(() => undefined)
      return { ok: false, error: proCreated.error }
    }
    compensateProfessional = async (): Promise<void> => {
      await emitEvent(ProfessionalConfig, `orgs/${orgId}/professionals/${proRef.id}`, {
        _tag: 'professional.deleted',
        actorId: session.uid,
        payload: {},
      })
      await proRef.delete().catch(() => undefined)
      await db
        .collection('orgs')
        .doc(orgId)
        .collection('professionals_pii')
        .doc(proRef.id)
        .delete()
        .catch(() => undefined)
    }
  }

  const inviteAccepted = await emitEvent(InviteConfig, `orgs/${orgId}/invites/${inviteId}`, {
    _tag: 'invite.updated',
    actorId: session.uid,
    payload: { changes: { status: 'accepted', acceptedByUid: session.uid, acceptedAt: now } },
  })
  if (!inviteAccepted.ok) {
    if (compensateProfessional) await compensateProfessional()
    await compensateMembership()
    return { ok: false, error: inviteAccepted.error }
  }

  await db
    .collection('users')
    .doc(session.uid)
    .set({ currentOrgId: invite.orgId, updatedAt: now }, { merge: true })

  redirect('/dashboard')
}
