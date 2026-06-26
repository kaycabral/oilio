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
import { parseOrgForm } from '@/features/onboarding/core/org-form'
import { newId } from '@/shared/db/pg/new-id'
import { getPublicOrgDocBySlug } from '@/shared/db/pg/public-org-directory'
import { patchUser } from '@/shared/db/pg/users-store'
import { commitSaga } from '@/shared/effect-bridge'
import { getSessionUser } from '@/shared/firebase/admin'

const SLUG_MAX_ATTEMPTS = 20

export type CreateOrgResult = { ok: true; orgId: string } | { ok: false; error: string }

// Identity-pure saga (org + membership + `users.currentOrgId`). Postgres ACID
// (brief 0061 § Grupo C / #1199): org + membership commit together or ROLLBACK as
// one — no manual compensation. The `users.currentOrgId` write is non-aggregate
// (global auth row) so it lands AFTER the tx commits (idempotent).
export async function createOrg(formData: FormData): Promise<CreateOrgResult> {
  const session = await getSessionUser()
  if (!session) return { ok: false, error: 'Not signed in' }
  if (!session.emailVerified) return { ok: false, error: 'Email not verified' }

  const parsed = parseOrgForm(formData)
  if (typeof parsed === 'string') return { ok: false, error: parsed }
  const { name, vertical } = parsed

  const slug = await generateUniqueSlug(name)
  if (!slug) return { ok: false, error: 'Could not generate a unique slug from the company name' }

  const orgId = newId()
  const now = new Date().toISOString()

  // The Org is a pure folder/shell (PRD Identidade v2): name, slug, segment
  // (vertical), branding, ownerUserId, timestamps. NO fiscal identity (the CNPJ
  // is the establishment's — `Unit.fiscal`) and NO agenda/self-booking config
  // (timezone, slot, cancellation, confirmation messages, self-booking publish
  // moved to `Unit.agenda`). Those are set per-unit when the first unit is
  // created. The projection stores only these fields.
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

  // NO auto-matriz (PRD Identidade v2 / brief 0046 AC-02): the Org (a pasta) is
  // born WITHOUT a unit — "Negócio sem unidade" right after signup is the
  // intentional empty-state that guides first-unit creation. The org + the
  // owner's membership are the two aggregates of this cascade; the `currentOrgId`
  // on the user is a non-aggregate auth-doc write that lands post-commit.

  // ACID (brief 0061 § Grupo C / #1199): org + membership commit together or
  // ROLLBACK as one — no manual compensation. The `users.currentOrgId` write is
  // non-aggregate (global auth row), so it lands AFTER the tx commits.
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
  if (!outcome.ok) return { ok: false, error: genericError }
  await patchUser(session.uid, { current_org_id: orgId }, now)

  // Return the new id WITHOUT navigating — the caller decides. Additional-Negócio
  // creation (`NewOrgDialog`) does a SOFT context switch in place (setActiveOrg +
  // router.refresh, mirroring `UnitOrgSwitcher`); first-Negócio onboarding
  // (`OnboardingForm`) enters the app client-side. No `redirect` here avoids the
  // hard navigation / full dashboard reload.
  return { ok: true, orgId }
}

// Org-slug uniqueness is a GLOBAL, non-org-scoped read (there is no `current_org`
// yet — the org is being born). It can't ride the org-scoped RLS on the `orgs`
// table, so it resolves through the public org directory (a public-by-contract
// projection, no RLS; brief 0062) — the same path `getOrgBySlug` uses. A free
// slug returns null from the directory.
async function generateUniqueSlug(name: string): Promise<string | null> {
  const base = slugify(name) || 'empresa'
  for (let i = 0; i < SLUG_MAX_ATTEMPTS; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`
    const taken = await getPublicOrgDocBySlug(candidate)
    if (!taken) return candidate
  }
  return null
}
