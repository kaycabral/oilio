'use server'

import {
  canInviteMembers,
  defaultPermissionsForRole,
  INVITE_TTL_MS,
  type Membership,
  membershipDocId,
  normalizeBrazilPhone,
  type Role,
  ROLES,
} from '@/domain'
import { InviteConfig, MemberOperationConfig, MembershipConfig } from '@/domain/aggregates'
import { generateInviteToken } from '@/features/invites/adapters/invite-token'
import { offboardMemberInOrg, type OffboardWarning } from '@/features/team/adapters/offboard-member'
import { buildMemberInviteWhatsapp } from '@/features/team/core/member-invite'
import { parseMemberOperationForm } from '@/features/team/core/member-operation-form'
import { deleteOrgProjectionDoc } from '@/shared/db/effect/delete-projection'
import { isForeignKeyViolation } from '@/shared/db/pg/fk-violation'
import { newId } from '@/shared/db/pg/new-id'
import { emitEvent } from '@/shared/effect-bridge'
import { classifyError } from '@/shared/errors/classify'
import { messageForCategory } from '@/shared/errors/messages'
import { getSessionUser } from '@/shared/firebase/admin'
import { formString } from '@/shared/form-data'
import { canDeleteMemberOperation } from '@/shared/org/delete-guard'
import { type StoredInvite, writeInvitePii } from '@/shared/org/invite-read'
import {
  deleteMemberOperationPii,
  writeMemberOperationPii,
} from '@/shared/org/member-operation-read'
import {
  assertCanManage,
  getActiveOrgContext,
  getMembership,
  requireManagerCtx,
  requireOwnerCtx,
} from '@/shared/org/membership'
import { getOrg } from '@/shared/org/org'
import { emitMemberFunnelEvent } from '@/shared/product/member-funnel-events'
import { resolveBaseUrl } from '@/shared/site-url'
import { revalidatePath } from 'next/cache'

import {
  aggregateRef,
  appendEventToTx,
  type SagaStep,
  type TransactionContext,
} from '@/domain/effect'
import { commitSaga } from '@/shared/effect-bridge'

import {
  resolveMemberOperatorRoleStep,
  validateServiceUnitIntersection,
} from './member-write-helpers'

export type CreateInviteResult =
  | { ok: true; inviteLink: string; whatsappHref: string }
  | { ok: false; error: string }

function isRole(v: string): v is Role {
  return (ROLES as readonly string[]).includes(v)
}

export async function createInvite(formData: FormData): Promise<CreateInviteResult> {
  const session = await getSessionUser()
  if (!session) return { ok: false, error: 'Not signed in' }

  const ctx = await getActiveOrgContext(session.uid)
  if (!ctx) return { ok: false, error: 'No active org' }

  if (!canInviteMembers(ctx.membership.role)) {
    return { ok: false, error: 'Only owners and managers can invite' }
  }
  assertCanManage(ctx.membership)

  const rawPhone = formString(formData, 'whatsapp')
  const role = formString(formData, 'role')

  const whatsapp = normalizeBrazilPhone(rawPhone)
  if (!whatsapp) return { ok: false, error: 'WhatsApp inválido' }
  if (!isRole(role)) return { ok: false, error: 'Invalid role' }
  if (role === 'owner') return { ok: false, error: 'Cannot invite as owner' }

  const now = Date.now()
  const { raw, hash } = generateInviteToken()

  const inviteId = newId()
  // PII (invitee WhatsApp) never enters the event payload (LGPD). The
  // projection stores only operational fields; the WhatsApp goes to the
  // deletable `invites_pii` doc and is merged on read (invite-read.ts). #1036.
  // Brief 0084: WhatsApp is the DELIVERY channel, not an accept-time match key.
  const stored: StoredInvite = {
    id: inviteId,
    orgId: ctx.membership.orgId,
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
  // Resolve the invite-link base BEFORE emitting `invite.created` (#1297): the old
  // order emitted first and only then read the origin, so a missing env threw AFTER
  // the event was persisted, leaving an orphan invite the operator couldn't see a
  // link for. `resolveBaseUrl` is the canonical helper (NEXT_PUBLIC_SITE_URL →
  // forwarded headers → localhost) and never throws, so the link always builds.
  const base = await resolveBaseUrl()

  await writeInvitePii(ctx.membership.orgId, inviteId, { mobile: whatsapp })
  const created = await emitEvent(
    InviteConfig,
    aggregateRef(InviteConfig, ctx.membership.orgId, stored.id),
    { _tag: 'invite.created', actorId: session.uid, payload: { data: stored } },
  )
  if (!created.ok) return { ok: false, error: created.error }

  const inviteLink = `${base}/invites/${ctx.membership.orgId}/${stored.id}?token=${raw}`

  // Deliver over WhatsApp (brief 0084): the owner sends the accept link through
  // the establishment's real channel instead of copying it. `normalizeBrazilPhone`
  // already succeeded above, so the wa.me build cannot fail here.
  const org = await getOrg(ctx.membership.orgId)
  const wa = buildMemberInviteWhatsapp({
    rawPhone: rawPhone,
    orgName: org?.name ?? 'Estabelecimento',
    inviteLink,
  })
  if (!wa.ok) return { ok: false, error: wa.error }

  // Funnel telemetry (brief 0084, Grupo D) — PII-zero, best-effort.
  await emitMemberFunnelEvent({
    event: 'member_invite_issued',
    orgId: ctx.membership.orgId,
    actorId: session.uid,
    role,
  })

  revalidatePath('/team')
  return { ok: true, inviteLink, whatsappHref: wa.href }
}

// ---------------------------------------------------------------------------
// MemberOperation operational edit — migrated from the killed `/memberOperations`
// route into the member detail (brief 0037 #1085 AC-01/AC-02). A MemberOperation
// is the operational projection of a `Membership(role=memberOperation)` + `User`;
// editing it is editing a member with extra fields. The actions live here,
// scoped to the member detail at `/team/{userId}`, and revalidate that path
// (no redirect to a dead route).
// ---------------------------------------------------------------------------

export type MemberOperationMutationResult = { ok: true } | { ok: false; error: string }

export async function updateMemberOperation(
  memberOperationId: string,
  formData: FormData,
): Promise<MemberOperationMutationResult> {
  const r = await requireManagerCtx()
  if (!r.ok) return r
  const parsed = parseMemberOperationForm(formData)
  if (typeof parsed === 'string') return { ok: false, error: parsed }

  const invariantErr = await validateServiceUnitIntersection(
    r.ctx.membership.orgId,
    parsed.catalogServiceIds,
    parsed.unitIds,
  )
  if (invariantErr) return { ok: false, error: invariantErr }

  const { taxIdentity, ...operational } = parsed
  // MemberOperation-scoped PII (taxIdentity) goes to the deletable
  // `member_operations_pii` doc, never to the event. Personal identity
  // (name/whatsapp/email) is NOT written here — it derives live from
  // `users/{userId}` (#1046 / AC-04).
  await writeMemberOperationPii(r.ctx.membership.orgId, memberOperationId, { taxIdentity })
  const updated = await emitEvent(
    MemberOperationConfig,
    aggregateRef(MemberOperationConfig, r.ctx.membership.orgId, memberOperationId),
    {
      _tag: 'member_operation.updated',
      actorId: r.ctx.session.uid,
      payload: { changes: { ...operational } },
    },
  )
  if (!updated.ok) return { ok: false, error: updated.error }

  // No approval event to emit (#1226 AC-02): `operationalStatus` is derived on
  // read from real facts (whatsapp ∧ units ∧ services), so the operational edit
  // above is sufficient — the next read recomputes readiness.

  revalidatePath('/team')
  return { ok: true }
}

export async function deleteMemberOperation(
  memberOperationId: string,
): Promise<MemberOperationMutationResult> {
  const r = await requireOwnerCtx()
  if (!r.ok) return r
  // Active-reference guard (brief 0033, AC-06 — defense-in-depth even when the
  // UI already hides Excluir). A memberOperation with a future appointment or an
  // active membership is a live dependency: the path is deactivate (0029) /
  // offboard (0041), never hard-delete. Offboarding sets `revoked` + cancels
  // future appointments, so a fully-offboarded pro clears this guard.
  if (!(await canDeleteMemberOperation(r.ctx.membership.orgId, memberOperationId))) {
    return { ok: false, error: 'Profissional tem vínculo ativo — desative ou remova do time.' }
  }
  const deleted = await emitEvent(
    MemberOperationConfig,
    aggregateRef(MemberOperationConfig, r.ctx.membership.orgId, memberOperationId),
    { _tag: 'member_operation.deleted', actorId: r.ctx.session.uid, payload: {} },
  )
  if (!deleted.ok) return { ok: false, error: deleted.error }
  // The `*.deleted` event skips reprojection; hard-delete the read-model row
  // (Postgres drops the typed `memberOperations` row, Firestore deletes the doc).
  // The `canDeleteMemberOperation` guard above already blocks live references, but
  // a cross-aggregate `ON DELETE RESTRICT` FK (brief 0068 D2 — appointments
  // referencing this memberOperation) is the DB's last-line guard: convert its
  // 23503 into a friendly result instead of a raw 500.
  try {
    await deleteOrgProjectionDoc(
      aggregateRef(MemberOperationConfig, r.ctx.membership.orgId, memberOperationId),
    )
  } catch (err) {
    if (isForeignKeyViolation(err)) {
      return {
        ok: false,
        error: 'Não é possível excluir este profissional: há agendamentos vinculados a ele.',
      }
    }
    // A non-FK defect (CHECK/RLS/unknown) would otherwise escape as a raw
    // 500; map it to the canonical generic message (detail stays in the log).
    return { ok: false as const, error: messageForCategory(classifyError(err)) }
  }
  // LGPD erasure — drop the PII doc alongside the projection.
  await deleteMemberOperationPii(r.ctx.membership.orgId, memberOperationId)
  revalidatePath('/team')
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Role-edit with projection lifecycle — brief 0037 #1086 (AC-04/AC-05/AC-06).
// Editing a member's role in-place is more than a field write: the MemberOperation
// projection is the operational view of a `Membership(role=memberOperation)`, so
// the role transition must keep that projection in sync, and permissions are
// re-derived so the ~47 role/permission read-sites never read stale.
//
// Saga (Postgres ACID, #1199): the membership and memberOperation aggregates commit
// their events in ONE transaction — a failure rolls back the lot, so there is no
// manual compensation. Erro à mostra, never silent.
//
// Lifecycle (closed decisions, brief 0037 + #1086 clarification + #1226 AC-02):
//   - →memberOperation : MATERIALIZE the projection if absent (same
//     `member_operation.created` path as the 0028 invite-accept flow, linked to
//     `userId`). If a projection already exists, leave it — readiness is derived
//     on read (`operationalStatus`), so no activation event is emitted.
//   - memberOperation→other : no projection event. `operationalStatus` is derived
//     on read (#1226 AC-02), so there is nothing to suspend here; severing a
//     demoted member's operability is the offboarding flow's job (brief 0041).
//   - always : re-derive `permissions{}` via `defaultPermissionsForRole(newRole)`
//     and persist on the membership (today `permissions{}` == role default, so
//     re-derive is safe — AC-06).
// ---------------------------------------------------------------------------

export type ChangeRoleResult = { ok: true } | { ok: false; error: string }

// Roles a member can be moved between via the UI. `owner` is excluded: it is
// the org-creator identity (onboarding), never assigned by role-edit — same
// guard as the invite flow (`createInvite` rejects `owner`).
const ASSIGNABLE_ROLES: readonly Role[] = ['manager', 'member_operator', 'receptionist'] as const

export async function changeMemberRole(
  targetUserId: string,
  newRole: Role,
): Promise<ChangeRoleResult> {
  // AC-04: owner/manager only.
  const r = await requireManagerCtx()
  if (!r.ok) return r
  const { orgId } = r.ctx.membership
  const actorId = r.ctx.session.uid

  if (!ASSIGNABLE_ROLES.includes(newRole)) {
    return { ok: false, error: 'Invalid target role' }
  }
  if (targetUserId === r.ctx.session.uid) {
    return { ok: false, error: 'Cannot change your own role' }
  }

  const membershipId = membershipDocId(orgId, targetUserId)
  const member = await getMembership(orgId, targetUserId)
  if (!member) return { ok: false, error: 'Member not found' }
  // The owner identity is immutable here (mirrors the `owner` exclusion above).
  if (member.role === 'owner') return { ok: false, error: 'Cannot change the owner role' }
  if (member.role === newRole) return { ok: true }

  const willBeMemberOperator = newRole === 'member_operator'

  // Step 1 — membership.updated: role + re-derived permissions in one event
  // (AC-06). State is projection (no dual-write): the reducer projects both.
  // Step 2 — the memberOperation projection lifecycle (≤1 projection per userId/org).

  // ACID (#1199): the membership role change + the memberOperation projection event
  // commit together or ROLLBACK as one — no manual compensation. The decision
  // (which memberOperation event, if any) is RESOLVED from reads up front so the
  // writes run as pure saga steps; a NEW projection's `member_operations_pii` sidecar
  // (non-aggregate) lands post-commit.
  const proStep = await resolveMemberOperatorRoleStep({
    orgId,
    actorId,
    targetUserId,
    willBeMemberOperator,
  })
  const steps: SagaStep[] = [
    (tx: TransactionContext) =>
      appendEventToTx(
        MembershipConfig,
        aggregateRef(MembershipConfig, orgId, membershipId),
        {
          _tag: 'membership.updated',
          actorId,
          payload: {
            changes: { role: newRole, permissions: defaultPermissionsForRole(newRole) },
          },
        },
        tx,
      ),
  ]
  if (proStep.kind !== 'none') {
    steps.push((tx: TransactionContext) =>
      appendEventToTx(
        MemberOperationConfig,
        aggregateRef(MemberOperationConfig, orgId, proStep.proId),
        proStep.input,
        tx,
      ),
    )
  }
  const outcome = await commitSaga(steps)
  if (!outcome.ok) return { ok: false, error: outcome.error }
  if (proStep.kind === 'create') {
    await writeMemberOperationPii(orgId, proStep.proId, { taxIdentity: null })
  }
  revalidatePath('/team')
  revalidatePath(`/team/${targetUserId}`)
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Deactivate / reactivate a member — brief 0029 #1053 (AC-10). Member-level
// lifecycle (vacation / dismissal / health), distinct from `operationalStatus`
// (memberOperation unit-activation, 0028) and `member_operation.suspended` (the role
// lifecycle projection, 0037). This flips `membership.status` active ↔
// suspended, event-sourced via `membership.updated` carrying ONLY `status`
// (same aggregate as `changeMemberRole`, different field — no conflict; the
// stream records who/when). A `suspended` membership stops operating: every
// operational read/write keys on `status == 'active'` (server resolvers via
// `getActiveOrgContext` / `getUserMemberships`; Firestore Rules via
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
  const { orgId } = r.ctx.membership
  const actorId = r.ctx.session.uid

  if (status !== 'active' && status !== 'suspended') {
    return { ok: false, error: 'Invalid target status' }
  }
  if (targetUserId === actorId) {
    return { ok: false, error: 'Cannot deactivate your own membership' }
  }

  const membershipId = membershipDocId(orgId, targetUserId)
  const member = await getMembership(orgId, targetUserId)
  if (!member) return { ok: false, error: 'Member not found' }
  // The owner is the org-creator identity — never deactivated (mirrors the
  // `owner` immutability in `changeMemberRole`).
  if (member.role === 'owner') return { ok: false, error: 'Cannot deactivate the owner' }
  if (member.status === status) return { ok: true }

  // Event-first: `membership.updated` with ONLY `status` (the reducer projects
  // it; replay reconstructs from the stream alone). Role/permissions untouched.
  const updated = await emitEvent(
    MembershipConfig,
    aggregateRef(MembershipConfig, orgId, membershipId),
    {
      _tag: 'membership.updated',
      actorId,
      payload: { changes: { status } },
    },
  )
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
// Distinct from customer erasure (brief 0032): the memberOperation/employment
// vínculo is a DIFFERENT relationship, retained ORIGINAL + IDENTIFIABLE for
// legal retention (art. 16). The offboarding NEVER anonymizes/scrubs/neutralizes
// — in particular it does NOT delete `member_operations_pii` (the conflict the brief
// flags against the old `deleteMemberOperation`). Vendas/comissões passadas keep
// the member's real name.
//
// Gating (AC-01): owner/manager only (`requireManagerCtx`); you CANNOT remove
// yourself (no self-lockout) nor the owner (org-creator identity) — same
// guards as `changeMemberRole` / `setMemberStatus`. The owner check + the
// idempotent saga core live in `offboardMemberInOrg` (session-free, so it is
// integration-testable); this action is the gated entry point.
// ---------------------------------------------------------------------------

// The result carries the non-blocking AC-08 warnings (e.g. a unit left with no
// active memberOperation) so the UI can surface them after a successful removal.
export type RemoveMemberResult =
  | { ok: true; warnings: OffboardWarning[] }
  | { ok: false; error: string }

export async function removeMemberFromTeam(targetUserId: string): Promise<RemoveMemberResult> {
  // AC-01: owner/manager only.
  const r = await requireManagerCtx()
  if (!r.ok) return r
  const { orgId } = r.ctx.membership
  const actorId = r.ctx.session.uid

  // AC-01: no self-lockout — you can't offboard yourself.
  if (targetUserId === actorId) {
    return { ok: false, error: 'Cannot remove yourself from the team' }
  }

  const result = await offboardMemberInOrg(orgId, targetUserId, actorId)
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
//   2. then, when the member stays a memberOperation, persist the operational
//      fields via `updateMemberOperation` (units/services/commission/tax, #1085).
// Event-first throughout (each underlying action emits its own domain events);
// role lifecycle runs before the operational write so the projection exists.
// The operational fields are only ever present when the member is (and remains)
// memberOperation — promotion to/demotion from memberOperation carries no operational
// payload (the form hides those fields for non-memberOperations), so there's no
// write against a not-yet/just-deactivated projection.
// ---------------------------------------------------------------------------

export type SaveMemberResult = { ok: true } | { ok: false; error: string }

export async function saveMemberDetail(input: {
  targetUserId: string
  currentRole: Role
  newRole: Role
  memberOperationId: string | null
  formData: FormData | null
}): Promise<SaveMemberResult> {
  const { targetUserId, currentRole, newRole, memberOperationId, formData } = input

  if (newRole !== currentRole) {
    const roleResult = await changeMemberRole(targetUserId, newRole)
    if (!roleResult.ok) return roleResult
  }

  // Operational persistence only applies when the member is (and remains) a
  // memberOperation with a materialized projection. Promotion to memberOperation in
  // this same save materializes the projection but shows no operational fields
  // yet (configured on the next visit); demotion has no operational payload.
  const staysMemberOperator = newRole === 'member_operator' && currentRole === 'member_operator'
  if (staysMemberOperator && memberOperationId && formData) {
    const opResult = await updateMemberOperation(memberOperationId, formData)
    if (!opResult.ok) return opResult
  }

  return { ok: true }
}
