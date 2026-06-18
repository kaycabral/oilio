'use server'

import {
  type Membership,
  type Role,
  DEFAULT_CANCELLATION_POLICY,
  DEFAULT_ORG_BRANDING,
  DEFAULT_ORG_TIMEZONE,
  DEFAULT_WHATSAPP_TEMPLATES,
  VERTICAL_DEFAULTS,
  defaultPermissionsForRole,
  membershipDocId,
  slugify,
} from '@/domain'
import { MembershipConfig, OrgConfig, UnitConfig } from '@/domain/aggregates'
import {
  buildMatrizUnit,
  matrizSlugCandidates,
  resolveMatrizPii,
} from '@/features/onboarding/core/matriz'
import { parseOrgForm } from '@/features/onboarding/core/org-form'
import { getAdminFirestore } from '@/shared/db'
import { emitEvent } from '@/shared/effect-bridge'
import { getSessionUser } from '@/shared/firebase/admin'
import { getUserDoc } from '@/shared/org/membership'
import { deleteUnitPii, writeUnitPii } from '@/shared/org/unit-read'
import { redirect } from 'next/navigation'

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

  // PII (taxIdentity = owner CPF/CNPJ) never enters the event payload (LGPD).
  // It's null at onboarding anyway; the owner fills it later via the company
  // form, which writes the deletable `orgs/{id}/private/taxIdentity` doc.
  // The projection stores only operational fields. #1036.
  const org = {
    id: orgId,
    name,
    slug,
    vertical,
    ownerUserId: session.uid,
    selfBookingPublished: false,
    selfBookingPublishedAt: null,
    timezone: DEFAULT_ORG_TIMEZONE,
    slotMinutes: VERTICAL_DEFAULTS[vertical].defaultSlotMinutes,
    branding: { ...DEFAULT_ORG_BRANDING },
    cancellationPolicy: { ...DEFAULT_CANCELLATION_POLICY },
    whatsappTemplates: { ...DEFAULT_WHATSAPP_TEMPLATES },
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

  // The matriz unit (the first establishment) is materialized in the SAME saga
  // so an Org never exists without a unit (the "empresa sem unidade" hole, F2 /
  // brief 0046, AC-02/AC-03). Its PII (whatsapp) is REQUIRED by the UnitPii
  // schema and is derived from the owner's completed profile — the org-creation
  // route (`/onboarding`) gates on `completionCompleted` (redirects to
  // `/onboarding/profile?next=/onboarding`), so at this point `User.whatsapp`
  // is set (the only completed-without-whatsapp state is the LGPD-anonymized
  // branch, which can't reach onboarding). We read the completed profile rather
  // than ever writing an empty whatsapp.
  const ownerUser = await getUserDoc(session.uid)
  const ownerPii = resolveMatrizPii(ownerUser)
  if (!ownerPii.ok) return { ok: false, error: ownerPii.error }

  const unitRef = db.collection('orgs').doc(orgId).collection('units').doc()
  const unitId = unitRef.id
  // Resolved before any event is emitted — nothing to compensate if it fails.
  const unitSlug = await generateUniqueUnitSlug(db, orgId, name)
  if (!unitSlug) {
    return { ok: false, error: 'Could not generate a unique slug for the matriz unit' }
  }

  // PII (whatsapp/email) never enters the unit event payload (LGPD); it goes to
  // the deletable `units_pii/{id}` doc and is merged on read.
  const matriz = buildMatrizUnit({ unitId, orgId, name, slug: unitSlug, now })

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
  // transação única). Passo 2: a unidade matriz nasce de `unit.created`
  // (projeção) + PII sidecar. Passo 3: o vínculo do dono nasce de
  // `membership.created`. Passo 4: a marca no usuário (doc de auth,
  // não-aggregate). Se algum falha, COMPENSA os anteriores (evento de desfazer +
  // remove o doc/PII) e retorna erro à mostra — sem órfão, sem erro silencioso.
  // Auditoria = stream.
  await writeUnitPii(orgId, unitId, ownerPii.pii)
  const unitCreated = await emitEvent(UnitConfig, `orgs/${orgId}/units/${unitId}`, {
    _tag: 'unit.created',
    actorId: session.uid,
    payload: { data: matriz },
  })
  const sagaRefs: SagaRefs = { orgId, unitId, orgRef, unitRef, actorId: session.uid }
  if (!unitCreated.ok) {
    await compensateOrgAndUnit(sagaRefs)
    return { ok: false, error: 'Não foi possível concluir a criação da conta. Tente de novo.' }
  }

  const membershipCreated = await emitEvent(MembershipConfig, `memberships/${membership.id}`, {
    _tag: 'membership.created',
    actorId: session.uid,
    payload: { data: membership },
  })
  if (!membershipCreated.ok) {
    await compensateOrgAndUnit(sagaRefs)
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
    await compensateOrgAndUnit(sagaRefs)
    return { ok: false, error: 'Não foi possível concluir a criação da conta. Tente de novo.' }
  }

  // No onboarding wizard (#1028) — the app is operable from signup (#986). The
  // (app) layout takes the owner to the operational app; setup happens
  // just-in-time via the empty-state CTAs (#987).
  redirect('/')
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

// Slug unique within the org's (brand-new, empty) units collection. Mirrors
// `resolveUnitSlug` in units.actions but for the auto-derived matriz: derives
// from the org name and escapes the reserved set. The org is fresh so there's
// no real collision, but we keep the loop + reserved-slug guard for parity.
async function generateUniqueUnitSlug(
  db: ReturnType<typeof getAdminFirestore>,
  orgId: string,
  name: string,
): Promise<string | null> {
  const unitsRef = db.collection('orgs').doc(orgId).collection('units')
  for (const candidate of matrizSlugCandidates(name, SLUG_MAX_ATTEMPTS)) {
    const taken = await unitsRef.where('slug', '==', candidate).limit(1).get()
    if (taken.empty) return candidate
  }
  return null
}

type SagaRefs = {
  orgId: string
  unitId: string
  orgRef: FirebaseFirestore.DocumentReference
  unitRef: FirebaseFirestore.DocumentReference
  actorId: string
}

// Compensation: undo the matriz unit (event + projection + PII sidecar). Used
// when a later saga step fails. Best-effort — failures here are swallowed so the
// caller can still report the original error to the user.
async function compensateUnit({ orgId, unitId, unitRef, actorId }: SagaRefs): Promise<void> {
  await emitEvent(UnitConfig, `orgs/${orgId}/units/${unitId}`, {
    _tag: 'unit.deleted',
    actorId,
    payload: {},
  })
  await unitRef.delete().catch(() => undefined)
  await deleteUnitPii(orgId, unitId).catch(() => undefined)
}

// Compensation: undo both the matriz unit and the org (leaf-first), leaving no
// partial state behind.
async function compensateOrgAndUnit(refs: SagaRefs): Promise<void> {
  await compensateUnit(refs)
  await emitEvent(OrgConfig, `orgs/${refs.orgId}`, {
    _tag: 'org.deleted',
    actorId: refs.actorId,
    payload: {},
  })
  await refs.orgRef.delete().catch(() => undefined)
}
