'use server'

import {
  canInviteMembers,
  defaultPermissionsForRole,
  INVITE_TTL_MS,
  Membership,
  membershipDocId,
  type Role,
  ROLES,
} from '@/domain'
import { InviteConfig, MembershipConfig, ProfessionalConfig } from '@/domain/aggregates'
import { generateInviteToken } from '@/features/invites/adapters/invite-token'
import {
  offboardMemberInTenant,
  type OffboardWarning,
} from '@/features/team/adapters/offboard-member'
import { parseProfessionalForm } from '@/features/team/core/professional-form'
import { getAdminFirestore } from '@/shared/db'
import { fsConverter } from '@/shared/db/converter'
import { emitEvent } from '@/shared/effect-bridge'
import { getSessionUser } from '@/shared/firebase/admin'
import { formString } from '@/shared/form-data'
import { canDeleteProfessional } from '@/shared/tenant/delete-guard'
import { type StoredInvite, writeInvitePii } from '@/shared/tenant/invite-read'
import {
  assertCanManage,
  getActiveTenantContext,
  requireManagerCtx,
  requireOwnerCtx,
} from '@/shared/tenant/membership'
import { deleteProfessionalPii, writeProfessionalPii } from '@/shared/tenant/professional-read'
import { revalidatePath } from 'next/cache'

import {
  reconcileApproval,
  syncProfessionalProjection,
  validateServiceUnitIntersection,
} from './member-write-helpers'

export type CreateInviteResult = { ok: true; inviteLink: string } | { ok: false; error: string }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function isRole(v: string): v is Role {
  return (ROLES as readonly string[]).includes(v)
}

export async function createInvite(formData: FormData): Promise<CreateInviteResult> {
  const session = await getSessionUser()
  if (!session) return { ok: false, error: 'Not signed in' }

  const ctx = await getActiveTenantContext(session.uid)
  if (!ctx) return { ok: false, error: 'No active tenant' }

  if (!canInviteMembers(ctx.membership.role)) {
    return { ok: false, error: 'Only owners and managers can invite' }
  }
  assertCanManage(ctx.membership)

  const email = formString(formData, 'email').trim().toLowerCase()
  const role = formString(formData, 'role')

  if (!EMAIL_RE.test(email)) return { ok: false, error: 'Invalid email' }
  if (!isRole(role)) return { ok: false, error: 'Invalid role' }
  if (role === 'owner') return { ok: false, error: 'Cannot invite as owner' }

  const db = getAdminFirestore()
  const now = Date.now()
  const { raw, hash } = generateInviteToken()

  const ref = db.collection('tenants').doc(ctx.membership.tenantId).collection('invites').doc()
  // PII (invitee email) never enters the event payload (LGPD). The
  // projection stores only operational fields; the email goes to the
  // deletable `invites_pii` doc and is merged on read (invite-read.ts). #1036.
  const stored: StoredInvite = {
    id: ref.id,
    tenantId: ctx.membership.tenantId,
    role,
    tokenHash: hash,
    expiresAt: new Date(now + INVITE_TTL_MS).toISOString(),
    status: 'pending',
    invitedBy: session.uid,
    acceptedByUid: null,
    acceptedAt: null,
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
  }
  await writeInvitePii(ctx.membership.tenantId, ref.id, { email })
  const created = await emitEvent(
    InviteConfig,
    `tenants/${ctx.membership.tenantId}/invites/${stored.id}`,
    { _tag: 'invite.created', actorId: session.uid, payload: { data: stored } },
  )
  if (!created.ok) return { ok: false, error: created.error }

  const origin = process.env.NEXT_PUBLIC_APP_URL ?? process.env.VERCEL_URL
  if (!origin) {
    throw new Error('NEXT_PUBLIC_APP_URL (or VERCEL_URL) must be set to build invite links')
  }
  const base = origin.startsWith('http') ? origin : `https://${origin}`
  const inviteLink = `${base}/invites/${ctx.membership.tenantId}/${stored.id}?token=${raw}`

  revalidatePath('/team')
  return { ok: true, inviteLink }
}

// ---------------------------------------------------------------------------
// Professional operational edit — migrated from the killed `/professionals`
// route into the member detail (brief 0037 #1085 AC-01/AC-02). A Professional
// is the operational projection of a `Membership(role=professional)` + `User`;
// editing it is editing a member with extra fields. The actions live here,
// scoped to the member detail at `/team/{userId}`, and revalidate that path
// (no redirect to a dead route).
// ---------------------------------------------------------------------------

export type ProfessionalMutationResult = { ok: true } | { ok: false; error: string }

export async function updateProfessional(
  professionalId: string,
  formData: FormData,
): Promise<ProfessionalMutationResult> {
  const r = await requireManagerCtx()
  if (!r.ok) return r
  const parsed = parseProfessionalForm(formData)
  if (typeof parsed === 'string') return { ok: false, error: parsed }

  const invariantErr = await validateServiceUnitIntersection(
    r.ctx.membership.tenantId,
    parsed.serviceIds,
    parsed.unitIds,
  )
  if (invariantErr) return { ok: false, error: invariantErr }

  const { taxIdentity, ...operational } = parsed
  // Professional-scoped PII (taxIdentity) goes to the deletable
  // `professionals_pii` doc, never to the event. Personal identity
  // (name/whatsapp/email) is NOT written here — it derives live from
  // `users/{userId}` (#1046 / AC-04).
  await writeProfessionalPii(r.ctx.membership.tenantId, professionalId, { taxIdentity })
  const updated = await emitEvent(
    ProfessionalConfig,
    `tenants/${r.ctx.membership.tenantId}/professionals/${professionalId}`,
    {
      _tag: 'professional.updated',
      actorId: r.ctx.session.uid,
      payload: { changes: { ...operational } },
    },
  )
  if (!updated.ok) return { ok: false, error: updated.error }

  // Derived approval (#1047 / AC-06/AC-07): after the operational change lands,
  // re-derive `operationalStatus` from real facts and emit the transition domain
  // event when it crosses. Event-first — the reducer projects the status, so
  // replay reconstructs it from the stream alone. Never written by a UI input.
  const derivedErr = await reconcileApproval({
    tenantId: r.ctx.membership.tenantId,
    professionalId,
    actorId: r.ctx.session.uid,
    unitIds: operational.unitIds,
    serviceIds: operational.serviceIds,
  })
  if (derivedErr) return { ok: false, error: derivedErr }

  revalidatePath('/team')
  return { ok: true }
}

export async function deleteProfessional(
  professionalId: string,
): Promise<ProfessionalMutationResult> {
  const r = await requireOwnerCtx()
  if (!r.ok) return r
  // Active-reference guard (brief 0033, AC-06 — defense-in-depth even when the
  // UI already hides Excluir). A professional with a future appointment or an
  // active membership is a live dependency: the path is deactivate (0029) /
  // offboard (0041), never hard-delete. Offboarding sets `revoked` + cancels
  // future appointments, so a fully-offboarded pro clears this guard.
  if (!(await canDeleteProfessional(r.ctx.membership.tenantId, professionalId))) {
    return { ok: false, error: 'Profissional tem vínculo ativo — desative ou remova do time.' }
  }
  const deleted = await emitEvent(
    ProfessionalConfig,
    `tenants/${r.ctx.membership.tenantId}/professionals/${professionalId}`,
    { _tag: 'professional.deleted', actorId: r.ctx.session.uid, payload: {} },
  )
  if (!deleted.ok) return { ok: false, error: deleted.error }
  await getAdminFirestore()
    .collection('tenants')
    .doc(r.ctx.membership.tenantId)
    .collection('professionals')
    .doc(professionalId)
    .delete()
  // LGPD erasure — drop the PII doc alongside the projection.
  await deleteProfessionalPii(r.ctx.membership.tenantId, professionalId)
  revalidatePath('/team')
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Role-edit with projection lifecycle — brief 0037 #1086 (AC-04/AC-05/AC-06).
// Editing a member's role in-place is more than a field write: the Professional
// projection is the operational view of a `Membership(role=professional)`, so
// the role transition must keep that projection in sync, and permissions are
// re-derived so the ~47 role/permission read-sites never read stale.
//
// Saga (event-first, NOT a single cross-aggregate transaction — root CLAUDE.md
// § cascade): the membership and professional aggregates each emit their own
// event in sequence, with compensation if a downstream step fails. Erro à
// mostra, never silent.
//
// Lifecycle (closed decisions, brief 0037 + #1086 clarification):
//   - →professional : MATERIALIZE the projection if absent (same
//     `professional.created` path as the 0028 invite-accept flow, linked to
//     `userId`); approval starts `none` (derived to `approved` later by
//     `reconcileApproval` once profile is complete). If a projection already
//     exists (member was professional before), leave it — `reconcileApproval`
//     re-derives whether it operates.
//   - professional→other : DEACTIVATE the projection via `professional.suspended`
//     (the 0028 event; reducer projects approval→`pending`, so
//     `isOperational` drops it off the public agenda/catalog — reversible,
//     history preserved). NOT `professional.deleted`. Per the #1086
//     clarification this does NOT block on brief 0033.
//   - always : re-derive `permissions{}` via `defaultPermissionsForRole(newRole)`
//     and persist on the membership (today `permissions{}` == role default, so
//     re-derive is safe — AC-06).
// ---------------------------------------------------------------------------

export type ChangeRoleResult = { ok: true } | { ok: false; error: string }

// Roles a member can be moved between via the UI. `owner` is excluded: it is
// the tenant-creator identity (onboarding), never assigned by role-edit — same
// guard as the invite flow (`createInvite` rejects `owner`).
const ASSIGNABLE_ROLES: readonly Role[] = ['manager', 'professional', 'receptionist'] as const

export async function changeMemberRole(
  targetUserId: string,
  newRole: Role,
): Promise<ChangeRoleResult> {
  // AC-04: owner/manager only.
  const r = await requireManagerCtx()
  if (!r.ok) return r
  const { tenantId } = r.ctx.membership
  const actorId = r.ctx.session.uid

  if (!ASSIGNABLE_ROLES.includes(newRole)) {
    return { ok: false, error: 'Invalid target role' }
  }
  if (targetUserId === r.ctx.session.uid) {
    return { ok: false, error: 'Cannot change your own role' }
  }

  const db = getAdminFirestore()
  const membershipId = membershipDocId(tenantId, targetUserId)
  const memberSnap = await db
    .collection('memberships')
    .withConverter(fsConverter(Membership))
    .doc(membershipId)
    .get()
  const member = memberSnap.data()
  if (!member) return { ok: false, error: 'Member not found' }
  // The owner identity is immutable here (mirrors the `owner` exclusion above).
  if (member.role === 'owner') return { ok: false, error: 'Cannot change the owner role' }
  if (member.role === newRole) return { ok: true }

  const previousRole = member.role
  const wasProfessional = previousRole === 'professional'
  const willBeProfessional = newRole === 'professional'

  // Step 1 — membership.updated: role + re-derived permissions in one event
  // (AC-06). State is projection (no dual-write): the reducer projects both.
  const roleChanged = await emitEvent(MembershipConfig, `memberships/${membershipId}`, {
    _tag: 'membership.updated',
    actorId,
    payload: { changes: { role: newRole, permissions: defaultPermissionsForRole(newRole) } },
  })
  if (!roleChanged.ok) return { ok: false, error: roleChanged.error }

  // Compensation for step 1 — restore the previous role + permissions.
  const compensateRole = async (): Promise<void> => {
    await emitEvent(MembershipConfig, `memberships/${membershipId}`, {
      _tag: 'membership.updated',
      actorId,
      payload: {
        changes: { role: previousRole, permissions: defaultPermissionsForRole(previousRole) },
      },
    }).catch(() => undefined)
  }

  // Step 2 — projection lifecycle (≤1 projection per userId per tenant).
  const projErr = await syncProfessionalProjection({
    db,
    tenantId,
    actorId,
    targetUserId,
    willBeProfessional,
    wasProfessional,
    compensateRole,
  })
  if (projErr) return { ok: false, error: projErr }

  revalidatePath('/team')
  revalidatePath(`/team/${targetUserId}`)
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Deactivate / reactivate a member — brief 0029 #1053 (AC-10). Member-level
// lifecycle (vacation / dismissal / health), distinct from `operationalStatus`
// (professional unit-activation, 0028) and `professional.suspended` (the role
// lifecycle projection, 0037). This flips `membership.status` active ↔
// suspended, event-sourced via `membership.updated` carrying ONLY `status`
// (same aggregate as `changeMemberRole`, different field — no conflict; the
// stream records who/when). A `suspended` membership stops operating: every
// operational read/write keys on `status == 'active'` (server resolvers via
// `getActiveTenantContext` / `getUserMemberships`; Firestore Rules via
// `isMember`), so a suspended member has no effective access until reactivated.
//
// Owner/manager only (`requireManagerCtx`). The owner identity can't be
// deactivated, and you can't deactivate yourself (no self-lockout) — both
// mirror the `changeMemberRole` guards.
// ---------------------------------------------------------------------------

export type SetMemberStatusResult = { ok: true } | { ok: false; error: string }

export async function setMemberStatus(
  targetUserId: string,
  status: Extract<Membership['status'], 'active' | 'suspended'>,
): Promise<SetMemberStatusResult> {
  const r = await requireManagerCtx()
  if (!r.ok) return r
  const { tenantId } = r.ctx.membership
  const actorId = r.ctx.session.uid

  if (status !== 'active' && status !== 'suspended') {
    return { ok: false, error: 'Invalid target status' }
  }
  if (targetUserId === actorId) {
    return { ok: false, error: 'Cannot deactivate your own membership' }
  }

  const db = getAdminFirestore()
  const membershipId = membershipDocId(tenantId, targetUserId)
  const memberSnap = await db
    .collection('memberships')
    .withConverter(fsConverter(Membership))
    .doc(membershipId)
    .get()
  const member = memberSnap.data()
  if (!member) return { ok: false, error: 'Member not found' }
  // The owner is the tenant-creator identity — never deactivated (mirrors the
  // `owner` immutability in `changeMemberRole`).
  if (member.role === 'owner') return { ok: false, error: 'Cannot deactivate the owner' }
  if (member.status === status) return { ok: true }

  // Event-first: `membership.updated` with ONLY `status` (the reducer projects
  // it; replay reconstructs from the stream alone). Role/permissions untouched.
  const updated = await emitEvent(MembershipConfig, `memberships/${membershipId}`, {
    _tag: 'membership.updated',
    actorId,
    payload: { changes: { status } },
  })
  if (!updated.ok) return { ok: false, error: updated.error }

  revalidatePath('/team')
  revalidatePath(`/team/${targetUserId}`)
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Unified member offboarding orchestration — brief 0041 #1103 (AC-01/AC-04/
// AC-10). A SINGLE "remover do time" entry point an establishment uses to
// offboard a member, ending their access. This is the FOUNDATION of the
// offboarding saga: #1104 (cancel future appointments / refuse open comanda /
// clean agenda-blocks) and #1105 (commissions / unit-capacity / invites) stack
// additional cascade steps on top of the skeleton below.
//
// Distinct from customer erasure (brief 0032): the professional/employment
// vínculo is a DIFFERENT relationship, retained ORIGINAL + IDENTIFIABLE for
// legal retention (art. 16). The offboarding NEVER anonymizes/scrubs/neutralizes
// — in particular it does NOT delete `professionals_pii` (the conflict the brief
// flags against the old `deleteProfessional`). Vendas/comissões passadas keep
// the member's real name.
//
// Gating (AC-01): owner/manager only (`requireManagerCtx`); you CANNOT remove
// yourself (no self-lockout) nor the owner (tenant-creator identity) — same
// guards as `changeMemberRole` / `setMemberStatus`. The owner check + the
// idempotent saga core live in `offboardMemberInTenant` (session-free, so it is
// integration-testable); this action is the gated entry point.
// ---------------------------------------------------------------------------

// The result carries the non-blocking AC-08 warnings (e.g. a unit left with no
// active professional) so the UI can surface them after a successful removal.
export type RemoveMemberResult =
  | { ok: true; warnings: OffboardWarning[] }
  | { ok: false; error: string }

export async function removeMemberFromTeam(targetUserId: string): Promise<RemoveMemberResult> {
  // AC-01: owner/manager only.
  const r = await requireManagerCtx()
  if (!r.ok) return r
  const { tenantId } = r.ctx.membership
  const actorId = r.ctx.session.uid

  // AC-01: no self-lockout — you can't offboard yourself.
  if (targetUserId === actorId) {
    return { ok: false, error: 'Cannot remove yourself from the team' }
  }

  const result = await offboardMemberInTenant(tenantId, targetUserId, actorId)
  if (!result.ok) return result

  // When there's an AC-08 capacity warning the UI STAYS on the member detail to
  // show it, so we skip revalidation here: revalidating `/team` (the parent
  // segment) would remount the client form and drop the warning before the owner
  // reads it. The page re-fetches fresh on the owner's next navigation anyway.
  // With no warning the UI navigates back to `/team`, so refresh both surfaces so
  // the removed member drops from the active list immediately.
  if (result.warnings.length === 0) {
    revalidatePath('/team')
    revalidatePath(`/team/${targetUserId}`)
  }
  return { ok: true, warnings: result.warnings }
}

// ---------------------------------------------------------------------------
// Single-Salvar member detail save — brief 0037 refino (review 2026-06-02).
// The member detail no longer gates the operational edit behind an "Editar"
// button nor exposes a separate "Trocar papel" action: an authorized user sees
// the editable fields directly and persists everything with ONE Salvar. This
// orchestrates the two existing flows in one call:
//   1. if the role changed → run the full `changeMemberRole` lifecycle first
//      (materialize/deactivate projection + re-derive permissions, #1086);
//   2. then, when the member stays a professional, persist the operational
//      fields via `updateProfessional` (units/services/commission/tax, #1085).
// Event-first throughout (each underlying action emits its own domain events);
// role lifecycle runs before the operational write so the projection exists.
// The operational fields are only ever present when the member is (and remains)
// professional — promotion to/demotion from professional carries no operational
// payload (the form hides those fields for non-professionals), so there's no
// write against a not-yet/just-deactivated projection.
// ---------------------------------------------------------------------------

export type SaveMemberResult = { ok: true } | { ok: false; error: string }

export async function saveMemberDetail(input: {
  targetUserId: string
  currentRole: Role
  newRole: Role
  professionalId: string | null
  formData: FormData | null
}): Promise<SaveMemberResult> {
  const { targetUserId, currentRole, newRole, professionalId, formData } = input

  if (newRole !== currentRole) {
    const roleResult = await changeMemberRole(targetUserId, newRole)
    if (!roleResult.ok) return roleResult
  }

  // Operational persistence only applies when the member is (and remains) a
  // professional with a materialized projection. Promotion to professional in
  // this same save materializes the projection but shows no operational fields
  // yet (configured on the next visit); demotion has no operational payload.
  const staysProfessional = newRole === 'professional' && currentRole === 'professional'
  if (staysProfessional && professionalId && formData) {
    const opResult = await updateProfessional(professionalId, formData)
    if (!opResult.ok) return opResult
  }

  return { ok: true }
}
