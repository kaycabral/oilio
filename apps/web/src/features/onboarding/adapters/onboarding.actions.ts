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
import { MembershipConfig, OrgConfig } from '@/domain/aggregates'
import { parseOrgForm } from '@/features/onboarding/core/org-form'
import { getAdminFirestore } from '@/shared/db'
import { emitEvent } from '@/shared/effect-bridge'
import { getSessionUser } from '@/shared/firebase/admin'
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

  // Event-first: a empresa nasce do evento `org.created` (a projeção escreve
  // o doc — sem `batch.set(orgRef)` paralelo). Auditoria = stream (sem
  // recordAudit de org.create).
  const created = await emitEvent(OrgConfig, `orgs/${orgId}`, {
    _tag: 'org.created',
    actorId: session.uid,
    payload: { data: org },
  })
  if (!created.ok) return { ok: false, error: created.error }

  // Saga recuperável com compensação (event-first; cada aggregate seu evento, sem
  // transação única). Passo 2: o vínculo do dono nasce de `membership.created`
  // (projeção). Passo 3: a marca no usuário (doc de auth, não-aggregate). Se algum
  // falha, COMPENSA os anteriores (evento de desfazer + remove o doc) e retorna
  // erro à mostra — sem órfão, sem erro silencioso. Auditoria = stream.
  const membershipCreated = await emitEvent(MembershipConfig, `memberships/${membership.id}`, {
    _tag: 'membership.created',
    actorId: session.uid,
    payload: { data: membership },
  })
  if (!membershipCreated.ok) {
    await emitEvent(OrgConfig, `orgs/${orgId}`, {
      _tag: 'org.deleted',
      actorId: session.uid,
      payload: {},
    })
    await orgRef.delete().catch(() => undefined)
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
    await emitEvent(OrgConfig, `orgs/${orgId}`, {
      _tag: 'org.deleted',
      actorId: session.uid,
      payload: {},
    })
    await orgRef.delete().catch(() => undefined)
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
