import { type Membership, membershipDocId } from '@/domain'
import {
  AgendaBlockConfig,
  AppointmentConfig,
  InviteConfig,
  MembershipConfig,
} from '@/domain/aggregates'
import {
  appendDeleteToTx,
  appendEventToTx,
  type SagaStep,
  type TransactionContext,
} from '@/domain/effect'
import { loadOpenOrdersForOrg } from '@/features/orders/adapters/order-financial-read'
import { getUserById } from '@/shared/db/pg/users-store'
import { commitSaga } from '@/shared/effect-bridge'
import { listAgendaBlocksByProfessionalId } from '@/shared/org/agenda-block-read'
import { listAppointmentsByProfessionalId } from '@/shared/org/appointment-read'
import { deleteInvitePii, listInvitesByStatus } from '@/shared/org/invite-read'
import { getMembership } from '@/shared/org/membership'
import { getProfessionalByUserId, listProfessionalsForOrg } from '@/shared/org/professional-read'
import 'server-only'

// Unified member offboarding saga core — brief 0041 #1103 (AC-04/AC-10). The
// gating (AC-01: owner/manager, no self, not the owner) lives in the server
// action (`removeMemberFromTeam`); this is the pure, session-free orchestration
// so it is integration-testable against the emulator (mirrors
// `erase-customer-cascade.ts`).
//
// Distinct from customer erasure (brief 0032): the professional/employment
// vínculo is a DIFFERENT relationship, retained ORIGINAL + IDENTIFIABLE for
// legal retention (art. 16). The offboarding NEVER anonymizes/scrubs — in
// particular it does NOT delete `professionals_pii`.
//
// Saga (Postgres ACID, brief 0061 § Grupo C / AC-03): all aggregate writes
// commit in ONE transaction (see `buildOffboardSteps`), so a failure of any step
// rolls back the whole offboard — there is NO manual compensation. Errors surface
// (never a silent partial removal); re-running is safe (idempotent — an
// already-revoked membership short-circuits to a no-op).
//   Step 1 — END MEMBERSHIP/ACCESS (AC-10): `membership.updated { status:
//     'revoked' }`. `revoked` is the existing terminal `MembershipStatus`
//     reserved for severance (NOT the reversible `suspended`, brief 0029).
//     Every access gate keys on `status == 'active'`, so a revoked member loses
//     access AND drops from the active team list.
//   Step 2 — DEACTIVATE the professional projection (if any): `professional
//     .suspended` (the same non-destructive event `changeMemberRole` uses for
//     demotion). NOT a destructive delete; the PII doc is RETAINED.
//   Step 3+ — CASCADE HOOKS for #1104 / #1105 (folded into the saga steps).
//
// #1104 fills the agenda/comanda/blocks cascade:
//   PRE-CHECK (AC-05, settlement-first) — runs BEFORE step 1, vetoing the whole
//     saga if the professional still has an OPEN order/comanda attributed to
//     them (a fiscal document must not be left orphaned). See `findOpenComanda`.
//   Step 3 (AC-02) — cancel the professional's FUTURE appointments
//     (`appointment.cancelled`, event-first). Past ones are LEFT; a cancelled
//     appointment is RETAINED struck-through in the grid (status flip, not
//     removal). Notifying the customer is the cancel event's downstream concern.
//   Step 4 (AC-07) — clean the professional's agenda-blocks
//     (`agenda_block.deleted` event-first, then hard-delete the projection —
//     mirrors `deleteBlock`).

// AC-06 (brief 0041, revised — commit 308146f): the offboarding does NOT read or
// gate on commissions. The "acerto entre as partes" for pending commissions is a
// real-world settlement between the parties, off-system — NOT systematized. The
// removed member's past/pending commissions are LEFT untouched: identifiable,
// retained, still attributed to the real name in reports (no veto, no warning, no
// anonymization). An earlier implementation vetoed on `liquidationStatus ==
// 'pendente'`; that pre-flight was removed when the owner rejected MR !1111.

// AC-08 non-blocking signal: removing this member zeroed the active-professional
// count of one or more units. Surfaced (NOT a veto) so the caller/UI can warn the
// owner that those units have no slots until another professional is assigned.
export type OffboardWarning = { kind: 'unit-without-professional'; unitIds: string[] }

export type OffboardResult =
  | { ok: true; warnings: OffboardWarning[] }
  | { ok: false; error: string }

// AC-05 pre-flight (settlement-first): is there an OPEN order attributed to this
// member? Attribution lives per-item as `attributedUserId` (the member's GLOBAL
// userId — brief 0030, AC-04), so an order counts when ANY of its items points
// at the target. Within-org query off the `status == 'open'` index (no
// cross-org query, no range scan); the open set is small. Returns the first
// offending order id, or null when clear. Read-only — vetoes BEFORE the saga
// mutates anything.
async function findOpenComanda(orgId: string, targetUserId: string): Promise<string | null> {
  // Read the open orders from the Postgres typed table (under RLS).
  const openOrders = await loadOpenOrdersForOrg(orgId)
  for (const order of openOrders) {
    if (order.items.some((item) => item.attributedUserId === targetUserId)) return order.id
  }
  return null
}

// AC-02 — cancel the professional's FUTURE appointments (`startAt` ahead of now,
// still `scheduled`). Keys off the professional DOC id (the FK appointments
// denormalize as `professionalId`), so it only has work when a projection
// exists. Past appointments are LEFT; a cancelled appointment is RETAINED
// struck-through in the grid (status flip, not removal). Event-first + idempotent
// (already cancelled/completed/no-show is skipped); within-org query (no
// range index — filters the future/scheduled subset in memory). Errors surface
// as a saga-aborting message.
// Resolves the FUTURE-scheduled appointments of a professional + the cancel
// payload for each (notice minutes from now) — read-only. Feeds the Postgres
// ACID saga the future-scheduled set + the cancel payload to append as pure
// steps.
async function resolveFutureAppointmentCancels(
  orgId: string,
  professionalId: string,
): Promise<{ id: string; cancelledAt: string; noticeMinutes: number }[]> {
  const appts = await listAppointmentsByProfessionalId(orgId, professionalId)
  const nowMs = Date.now()
  const now = new Date().toISOString()
  const cancels: { id: string; cancelledAt: string; noticeMinutes: number }[] = []
  for (const appt of appts) {
    if (appt.status !== 'scheduled') continue
    if (new Date(appt.startAt).getTime() <= nowMs) continue
    const noticeMinutes = Math.max(
      0,
      Math.round((new Date(appt.startAt).getTime() - nowMs) / 60000),
    )
    cancels.push({ id: appt.id, cancelledAt: now, noticeMinutes })
  }
  return cancels
}

// AC-08 — unit-capacity warning (#1105, edge, NON-BLOCKING). Surface a warning
// for any unit (`professional.unitIds`) the removed member belonged to that now
// has ZERO active professionals. Bookings on those units would have no slots —
// the owner must be told (never a silent gap), but it does NOT block the removal.
//
// Reads ALL professionals for the org (enriched, so `operationalStatus` is the
// value DERIVED on read — #1226 AC-02) and excludes the removed projection
// EXPLICITLY by id, so it never counts itself as staffing (its projection still
// derives `operational` until deleted). Active = `operationalStatus == 'operational'`.
// Within-org read; small set. Read-only.
async function detectUnitsLeftWithoutProfessional(
  orgId: string,
  removedProfessionalId: string,
  removedUnitIds: readonly string[],
): Promise<string[]> {
  if (removedUnitIds.length === 0) return []
  // Read all professionals for the org (enriched; we only read operationalStatus
  // + unitIds, both projection fields).
  const professionals = await listProfessionalsForOrg(orgId)
  const stillStaffed = new Set<string>()
  for (const pro of professionals) {
    if (pro.id === removedProfessionalId) continue
    if (pro.operationalStatus !== 'operational') continue
    for (const unitId of pro.unitIds ?? []) stillStaffed.add(unitId)
  }
  return [...new Set(removedUnitIds)].filter((unitId) => !stillStaffed.has(unitId)).sort()
}

// The fully-resolved offboard cascade — every read done up front so the writes
// can run as pure saga steps inside one transaction (Postgres ACID path).
export type ResolvedOffboard = {
  membershipId: string
  previousStatus: Membership['status']
  professionalId: string | null
  appointmentCancels: { id: string; cancelledAt: string; noticeMinutes: number }[]
  agendaBlockIds: string[]
  inviteIds: string[]
}

// Resolves the member's email (for invite matching) from the live User row.
async function resolveMemberEmail(targetUserId: string): Promise<string | null> {
  const user = await getUserById(targetUserId)
  const email = user?.email ?? null
  return email ? email.trim().toLowerCase() : null
}

// Builds the offboard cascade as ACID saga steps (brief 0061 § Grupo C / AC-03):
// membership revoked + future appointments cancelled + agenda-blocks deleted
// (event + row drop) + pending invites deleted (event + row drop), all THROUGH
// the shared tx. No `professional.suspended` step (#1226 AC-02 — derived status). A failure of any step rolls back the whole
// offboard — no manual `compensateMembership`. The `*.deleted` steps use
// `appendDeleteToTx` so the projection row is dropped in the same tx; the
// `invites_pii` LGPD sidecar is deleted AFTER commit (not an event-store row).
export function buildOffboardSteps(
  resolved: ResolvedOffboard,
  orgId: string,
  actorId: string,
): SagaStep[] {
  const steps: SagaStep[] = []

  steps.push((tx: TransactionContext) =>
    appendEventToTx(
      MembershipConfig,
      `memberships/${resolved.membershipId}`,
      {
        _tag: 'membership.updated',
        actorId,
        payload: { changes: { status: 'revoked' } },
      },
      tx,
    ),
  )

  // No `professional.suspended` step (#1226 AC-02): the professional's
  // `operationalStatus` is derived on read, and the revoked membership above
  // already severs operability (every operational read keys on an active
  // membership). The future appointments are still cancelled below.

  for (const cancel of resolved.appointmentCancels) {
    steps.push((tx: TransactionContext) =>
      appendEventToTx(
        AppointmentConfig,
        `orgs/${orgId}/appointments/${cancel.id}`,
        {
          _tag: 'appointment.cancelled',
          actorId,
          payload: {
            cancelledBy: 'system',
            cancelledAt: cancel.cancelledAt,
            noticeMinutes: cancel.noticeMinutes,
          },
        },
        tx,
      ),
    )
  }

  for (const blockId of resolved.agendaBlockIds) {
    steps.push((tx: TransactionContext) =>
      appendDeleteToTx(
        AgendaBlockConfig,
        `orgs/${orgId}/agenda_blocks/${blockId}`,
        {
          _tag: 'agenda_block.deleted',
          actorId,
          payload: {},
        },
        tx,
      ),
    )
  }

  for (const inviteId of resolved.inviteIds) {
    steps.push((tx: TransactionContext) =>
      appendDeleteToTx(
        InviteConfig,
        `orgs/${orgId}/invites/${inviteId}`,
        {
          _tag: 'invite.deleted',
          actorId,
          payload: {},
        },
        tx,
      ),
    )
  }

  return steps
}

// The Postgres offboard: resolve every read, run all aggregate writes as ONE
// ACID transaction, then drop the LGPD invite PII sidecars (post-commit — not an
// event-store row). Returns the removed professional's unit ids (for the AC-08
// warning) + the result, or an error string.
async function offboardMemberPostgres(args: {
  orgId: string
  targetUserId: string
  actorId: string
  previousStatus: Membership['status']
  // The member's professional projection, ALREADY loaded by the caller (avoid a
  // second `getProfessionalByUserId` + its PII/users enrich fan-out).
  existingPro: { id: string; unitIds?: readonly string[] } | null
}): Promise<{ ok: true; removedUnitIds: readonly string[] } | { ok: false; error: string }> {
  const { orgId, targetUserId, actorId, previousStatus, existingPro } = args
  const membershipId = membershipDocId(orgId, targetUserId)
  const professionalId = existingPro?.id ?? null
  const removedUnitIds = existingPro ? (existingPro.unitIds ?? []) : []

  const appointmentCancels = professionalId
    ? await resolveFutureAppointmentCancels(orgId, professionalId)
    : []
  const agendaBlocks = professionalId
    ? await listAgendaBlocksByProfessionalId(orgId, professionalId)
    : []
  const email = await resolveMemberEmail(targetUserId)
  const pendingInvites = email
    ? (await listInvitesByStatus(orgId, 'pending')).filter(
        (invite) => invite.email && invite.email.trim().toLowerCase() === email,
      )
    : []

  const resolved: ResolvedOffboard = {
    membershipId,
    previousStatus,
    professionalId,
    appointmentCancels,
    agendaBlockIds: agendaBlocks.map((b) => b.id),
    inviteIds: pendingInvites.map((i) => i.id),
  }

  const outcome = await commitSaga(buildOffboardSteps(resolved, orgId, actorId))
  if (!outcome.ok) return { ok: false, error: outcome.error }

  // Post-commit: drop the invite PII sidecars (LGPD) — not an event-store row, so
  // it can't ride the tx. Idempotent; a partial failure here leaves the projection
  // already removed (the membership/cascade are committed and coherent).
  for (const inviteId of resolved.inviteIds) {
    await deleteInvitePii(orgId, inviteId)
  }

  return { ok: true, removedUnitIds }
}

export async function offboardMemberInOrg(
  orgId: string,
  targetUserId: string,
  actorId: string,
): Promise<OffboardResult> {
  const member = await getMembership(orgId, targetUserId)
  if (!member) return { ok: false, error: 'Member not found' }
  // The owner is the org-creator identity — never offboarded.
  if (member.role === 'owner') return { ok: false, error: 'Cannot remove the owner' }
  // AC-04 idempotency: an already-revoked membership short-circuits to a no-op
  // (re-running is safe, no throw, no duplicate events).
  if (member.status === 'revoked') return { ok: true, warnings: [] }

  // AC-05 PRE-FLIGHT (settlement-first): refuse the WHOLE saga while the member
  // still has an OPEN order/comanda attributed to them — a fiscal document must
  // not be orphaned. Runs BEFORE any mutation (no membership end, no
  // compensation needed), so the member is left fully intact and the owner is
  // told to settle first. The "acerto entre as partes" precedes removal.
  const openComanda = await findOpenComanda(orgId, targetUserId)
  if (openComanda) {
    return {
      ok: false,
      error: 'Feche ou cancele a comanda aberta deste profissional antes de removê-lo.',
    }
  }

  // AC-06 (revised): NO commission veto. The "acerto entre as partes" is an
  // off-system settlement between the parties — not systematized. The member's
  // pending/past commissions are left untouched (identifiable, retained), so the
  // saga proceeds regardless of their liquidation status.

  const previousStatus = member.status

  // The whole offboard (membership revoke + professional suspend + appointment
  // cancels + agenda-block/invite deletes) runs as ONE ACID transaction (brief
  // 0061 § Grupo C / AC-03) — there is no manual compensation (a failure rolls
  // back the lot). The AC-08 warning is computed after, from the committed state.
  const existingPro = await getProfessionalByUserId(orgId, targetUserId)
  const result = await offboardMemberPostgres({
    orgId,
    targetUserId,
    actorId,
    previousStatus,
    existingPro,
  })
  if (!result.ok) return { ok: false, error: result.error }
  const unitsWithoutProfessional = existingPro
    ? await detectUnitsLeftWithoutProfessional(orgId, existingPro.id, result.removedUnitIds)
    : []
  const warnings: OffboardWarning[] =
    unitsWithoutProfessional.length > 0
      ? [{ kind: 'unit-without-professional', unitIds: unitsWithoutProfessional }]
      : []
  return { ok: true, warnings }
}
