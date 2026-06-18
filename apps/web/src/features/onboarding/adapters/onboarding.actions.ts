'use server'

import {
  type Membership,
  type Role,
  DEFAULT_ORG_BRANDING,
  defaultPermissionsForRole,
  membershipDocId,
  slugify,
} from '@/domain'
import { MembershipConfig, OrgConfig } from '@/domain/aggregates'
import { parseOrgForm } from '@/features/onboarding/core/org-form'
import { getAdminFirestore } from '@/shared/db'
import { emitEvent } from '@/shared/effect-bridge'
import { getSessionUser } from '@/shared/firebase/admin'

const SLUG_MAX_ATTEMPTS = 20

export type CreateOrgResult = { ok: true; orgId: string } | { ok: false; error: string }

export async function createOrg(formData: FormData): Promise<CreateOrgResult> {
  const session = await getSessionUser()
  if (!session) return { ok: false, error: 'Not signed in' }
  if (!session.emailVerified) return { ok: false, error: 'Email not verified' }

  const parsed = parseOrgForm(formData)
  if (typeof parsed === 'string') return { ok: false, error: parsed }
  const { name, vertical } = parsed

  const db = getAdminFirestore()
  const slug = await generateUniqueSlug(db, name)
  if (!slug) return { ok: false, error: 'Could not generate a unique slug from the company name' }

  const orgRef = db.collection('orgs').doc()
  const orgId = orgRef.id
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
    unitId: null,
    permissions: defaultPermissionsForRole(ownerRole),
    commissionRate: null,
  }

  const userRef = db.collection('users').doc(session.uid)

  // Event-first: the org is born from `org.created` (the projection writes the
  // doc — no parallel `batch.set(orgRef)`). Auditoria = stream (sem recordAudit
  // de org.create).
  const created = await emitEvent(OrgConfig, `orgs/${orgId}`, {
    _tag: 'org.created',
    actorId: session.uid,
    payload: { data: org },
  })
  if (!created.ok) return { ok: false, error: created.error }

  // Saga recuperável com compensação (event-first; cada aggregate seu evento, sem
  // transação única). NO auto-matriz (PRD Identidade v2 / brief 0046 AC-02): the
  // Org (a pasta) is born WITHOUT a unit — "Negócio sem unidade" right after
  // signup is the intentional empty-state that guides first-unit creation. Passo
  // 2: o vínculo do dono nasce de `membership.created`. Passo 3: o
  // `currentOrgId` no usuário (doc de auth, não-aggregate). Se algum falha,
  // COMPENSA os anteriores e retorna erro à mostra — sem órfão, sem erro
  // silencioso. Auditoria = stream.
  const sagaRefs: SagaRefs = { orgId, orgRef, actorId: session.uid }

  const membershipCreated = await emitEvent(MembershipConfig, `memberships/${membership.id}`, {
    _tag: 'membership.created',
    actorId: session.uid,
    payload: { data: membership },
  })
  if (!membershipCreated.ok) {
    await compensateOrg(sagaRefs)
    return { ok: false, error: 'Não foi possível concluir a criação da conta. Tente de novo.' }
  }
  try {
    await userRef.set({ currentOrgId: orgId, updatedAt: now }, { merge: true })
  } catch {
    await emitEvent(MembershipConfig, `memberships/${membership.id}`, {
      _tag: 'membership.deleted',
      actorId: session.uid,
      payload: {},
    })
    await db
      .collection('memberships')
      .doc(membership.id)
      .delete()
      .catch(() => undefined)
    await compensateOrg(sagaRefs)
    return { ok: false, error: 'Não foi possível concluir a criação da conta. Tente de novo.' }
  }

  // Return the new id WITHOUT navigating — the caller decides. Additional-Negócio
  // creation (`NewOrgDialog`) does a SOFT context switch in place (setActiveOrg +
  // router.refresh, mirroring `UnitOrgSwitcher`); first-Negócio onboarding
  // (`OnboardingForm`) enters the app client-side. No `redirect` here avoids the
  // hard navigation / full dashboard reload.
  return { ok: true, orgId }
}

async function generateUniqueSlug(
  db: ReturnType<typeof getAdminFirestore>,
  name: string,
): Promise<string | null> {
  const base = slugify(name) || 'empresa'
  for (let i = 0; i < SLUG_MAX_ATTEMPTS; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`
    const taken = await db.collection('orgs').where('slug', '==', candidate).limit(1).get()
    if (taken.empty) return candidate
  }
  return null
}

type SagaRefs = {
  orgId: string
  orgRef: FirebaseFirestore.DocumentReference
  actorId: string
}

// Compensation: undo the org (event + projection), leaving no partial state
// behind. Best-effort — failures here are swallowed so the caller can still
// report the original error to the user.
async function compensateOrg(refs: SagaRefs): Promise<void> {
  await emitEvent(OrgConfig, `orgs/${refs.orgId}`, {
    _tag: 'org.deleted',
    actorId: refs.actorId,
    payload: {},
  })
  await refs.orgRef.delete().catch(() => undefined)
}
