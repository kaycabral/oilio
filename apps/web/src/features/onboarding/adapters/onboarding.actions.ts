'use server'

import {
  DEFAULT_ORG_BRANDING,
  defaultPermissionsForRole,
  membershipDocId,
  slugify,
  type Membership,
  type Role,
} from '@/domain'
import { MembershipConfig, OrgConfig } from '@/domain/aggregates'
import { aggregateRef, appendEventToTx, type TransactionContext } from '@/domain/effect'
import { withUserOnboardingLock } from '@/features/onboarding/adapters/onboarding-lock'
import { parseOrgForm } from '@/features/onboarding/core/org-form'
import { getSessionUser } from '@/shared/auth/session'
import { newId } from '@/shared/db/pg/new-id'
import { getPublicOrgDocBySlug } from '@/shared/db/pg/public-org-directory'
import { patchUser } from '@/shared/db/pg/users-store'
import { commitSaga } from '@/shared/effect-bridge'
import { getOrgBilling } from '@/shared/org/billing-read'
import { getUserMemberships } from '@/shared/org/membership'

const SLUG_MAX_ATTEMPTS = 20

export type CreateOrgResult = { ok: true; orgId: string } | { ok: false; error: string }

async function secondOrgDenied(userId: string): Promise<string | null> {
  const ownerOrgIds = (await getUserMemberships(userId))
    .filter((m) => m.role === 'owner')
    .map((m) => m.orgId)
  if (ownerOrgIds.length === 0) return null
  const billings = await Promise.all(ownerOrgIds.map((id) => getOrgBilling(id)))
  const hasPaid = billings.some((b) => b.tier !== 'free')
  return hasPaid
    ? null
    : 'O plano Grátis permite 1 negócio. Faça upgrade de um negócio para o Pro para criar outro.'
}

export async function createOrg(formData: FormData): Promise<CreateOrgResult> {
  const session = await getSessionUser()
  if (!session) return { ok: false, error: 'Not signed in' }
  if (!session.emailVerified) return { ok: false, error: 'Email not verified' }

  const fastDenial = await secondOrgDenied(session.uid)
  if (fastDenial) return { ok: false, error: fastDenial }

  const parsed = parseOrgForm(formData)
  if (typeof parsed === 'string') return { ok: false, error: parsed }
  const { name, vertical } = parsed

  const slug = await generateUniqueSlug(name)
  if (!slug) return { ok: false, error: 'Could not generate a unique slug from the company name' }

  const orgId = newId()
  const now = new Date().toISOString()

  const org = {
    id: orgId,
    name,
    slug,
    vertical,
    ownerUserId: session.uid,
    branding: { ...DEFAULT_ORG_BRANDING },
    createdAt: now,
    updatedAt: now,
  }

  const ownerRole: Role = 'owner'
  const membership: Membership = {
    id: membershipDocId(orgId, session.uid),
    orgId,
    userId: session.uid,
    role: ownerRole,
    status: 'active',
    invitedBy: null,
    joinedAt: now,
    updatedAt: now,
    rlsUnitScope: null,
    permissions: defaultPermissionsForRole(ownerRole),
  }

  const genericError = 'Não foi possível concluir a criação da conta. Tente de novo.'

  const lockedOutcome = await withUserOnboardingLock(session.uid, async () => {
    const denial = await secondOrgDenied(session.uid)
    if (denial) return { ok: false as const, error: denial }

    const outcome = await commitSaga([
      (tx: TransactionContext) =>
        appendEventToTx(
          OrgConfig,
          aggregateRef(OrgConfig, orgId, orgId),
          {
            _tag: 'org.created',
            actorId: session.uid,
            payload: { data: org },
          },
          tx,
        ),
      (tx: TransactionContext) =>
        appendEventToTx(
          MembershipConfig,
          aggregateRef(MembershipConfig, orgId, membership.id),
          {
            _tag: 'membership.created',
            actorId: session.uid,
            payload: { data: membership },
          },
          tx,
        ),
    ])
    return outcome.ok ? { ok: true as const } : { ok: false as const, error: genericError }
  })
  if (!lockedOutcome.ok) return { ok: false, error: lockedOutcome.error }
  await patchUser(session.uid, { current_org_id: orgId }, now)

  return { ok: true, orgId }
}

async function generateUniqueSlug(name: string): Promise<string | null> {
  const base = slugify(name) || 'empresa'
  for (let i = 0; i < SLUG_MAX_ATTEMPTS; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`
    const taken = await getPublicOrgDocBySlug(candidate)
    if (!taken) return candidate
  }
  return null
}
