import {
  AgendaBlock,
  Appointment,
  Membership,
  Order,
  StoredInvite,
  StoredProfessional,
  User,
  membershipDocId,
} from '@/domain'
import {
  AgendaBlockConfig,
  AppointmentConfig,
  InviteConfig,
  MembershipConfig,
  ProfessionalConfig,
} from '@/domain/aggregates'
import { getAdminFirestore } from '@/shared/db'
import { fsConverter } from '@/shared/db/converter'
import { emitEvent } from '@/shared/effect-bridge'
import { deleteInvitePii } from '@/shared/org/invite-read'
import { Schema } from 'effect'
import 'server-only'

// Minimal projection — the pending-invite cleanup only reads the PII doc's email.
const InviteEmailProbe = Schema.Struct({ email: Schema.optional(Schema.String) })

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
// Saga (event-first, NOT a single cross-aggregate transaction — root CLAUDE.md
// § cascade): each aggregate emits its OWN event in sequence; errors surface
// (never a silent partial removal); re-running is safe (idempotent — an
// already-revoked membership short-circuits to a no-op). Compensation restores
// the prior membership status if a downstream step fails.
//   Step 1 — END MEMBERSHIP/ACCESS (AC-10): `membership.updated { status:
//     'revoked' }`. `revoked` is the existing terminal `MembershipStatus`
//     reserved for severance (NOT the reversible `suspended`, brief 0029).
//     Every access gate keys on `status == 'active'` (resolvers + Firestore
//     Rules `isMember`), so a revoked member loses access AND drops from the
//     active team list.
//   Step 2 — DEACTIVATE the professional projection (if any): `professional
//     .suspended` (the same non-destructive event `changeMemberRole` uses for
//     demotion). NOT a destructive delete; the PII doc is RETAINED.
//   Step 3+ — CASCADE HOOKS for #1104 / #1105 (`runOffboardingCascade`).
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
  const snap = await getAdminFirestore()
    .collection('orgs')
    .doc(orgId)
    .collection('orders')
    .where('status', '==', 'open')
    .withConverter(fsConverter(Order))
    .get()
  for (const doc of snap.docs) {
    const order = doc.data()
    if (order.items.some((item) => item.attributedUserId === targetUserId)) return doc.id
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
async function cancelFutureAppointments(
  orgId: string,
  professionalId: string,
  actorId: string,
): Promise<string | null> {
  const snap = await getAdminFirestore()
    .collection('orgs')
    .doc(orgId)
    .collection('appointments')
    .where('professionalId', '==', professionalId)
    .withConverter(fsConverter(Appointment))
    .get()
  const nowMs = Date.now()
  for (const doc of snap.docs) {
    const appt = doc.data()
    if (appt.status !== 'scheduled') continue
    if (new Date(appt.startAt).getTime() <= nowMs) continue
    const now = new Date().toISOString()
    const noticeMinutes = Math.max(
      0,
      Math.round((new Date(appt.startAt).getTime() - nowMs) / 60000),
    )
    const cancelled = await emitEvent(AppointmentConfig, `orgs/${orgId}/appointments/${doc.id}`, {
      _tag: 'appointment.cancelled',
      actorId,
      payload: { cancelledBy: 'system', cancelledAt: now, noticeMinutes },
    })
    if (!cancelled.ok) return `Failed to cancel appointment ${doc.id}: ${cancelled.error}`
  }
  return null
}

// AC-07 — clean the professional's agenda-blocks. Keys off the professional DOC
// id (`agenda_blocks.professionalId`); org-wide blocks (`professionalId ==
// null`) are NOT the member's and stay. Event-first (`agenda_block.deleted`)
// then hard-delete the projection — mirrors `deleteBlock` (the event store does
// NOT reproject a delete, so the caller removes the doc; history lives in the
// subcollection). Idempotent: re-running finds none. Errors surface.
async function cleanAgendaBlocks(
  orgId: string,
  professionalId: string,
  actorId: string,
): Promise<string | null> {
  const db = getAdminFirestore()
  const snap = await db
    .collection('orgs')
    .doc(orgId)
    .collection('agenda_blocks')
    .where('professionalId', '==', professionalId)
    .withConverter(fsConverter(AgendaBlock))
    .get()
  for (const doc of snap.docs) {
    const block = doc.data()
    const deleted = await emitEvent(AgendaBlockConfig, `orgs/${orgId}/agenda_blocks/${block.id}`, {
      _tag: 'agenda_block.deleted',
      actorId,
      payload: {},
    })
    if (!deleted.ok) return `Failed to delete agenda-block ${block.id}: ${deleted.error}`
    await doc.ref.delete()
  }
  return null
}

// AC-09 — clean the member's PENDING invites in this org (#1105). A removed
// member could still hold an open invite (e.g. re-invited under another role
// before removal); an orphan pending invite would also block a clean re-invite
// later. Matched by EMAIL (the invite's identity, per AC-09) — the email lives in
// the deletable `invites_pii` doc, so we read the member's live email from
// `users/{userId}` and compare. Only `pending` invites are cleaned (accepted/
// expired/revoked are historical and left). Event-first (`invite.deleted`) then
// drop the `invites_pii` doc (the email PII) — mirrors the invite-create write
// pairing. Idempotent: re-running finds none. Errors surface.
async function cleanPendingInvites(
  orgId: string,
  targetUserId: string,
  actorId: string,
): Promise<string | null> {
  const db = getAdminFirestore()
  const userSnap = await db
    .collection('users')
    .doc(targetUserId)
    .withConverter(fsConverter(User))
    .get()
  const email = userSnap.data()?.email ?? null
  // No email on file → nothing to match an invite against (invites are keyed by
  // invitee email). Nothing to clean.
  if (!email) return null
  const normalizedEmail = email.trim().toLowerCase()

  const snap = await db
    .collection('orgs')
    .doc(orgId)
    .collection('invites')
    .where('status', '==', 'pending')
    .withConverter(fsConverter(StoredInvite))
    .get()
  for (const doc of snap.docs) {
    const invite = doc.data()
    const piiSnap = await db
      .collection('orgs')
      .doc(orgId)
      .collection('invites_pii')
      .doc(doc.id)
      .withConverter(fsConverter(InviteEmailProbe))
      .get()
    const inviteEmail = piiSnap.data()?.email
    if (!inviteEmail || inviteEmail.trim().toLowerCase() !== normalizedEmail) continue

    const deleted = await emitEvent(InviteConfig, `orgs/${orgId}/invites/${invite.id}`, {
      _tag: 'invite.deleted',
      actorId,
      payload: {},
    })
    if (!deleted.ok) return `Failed to delete invite ${invite.id}: ${deleted.error}`
    await doc.ref.delete()
    await deleteInvitePii(orgId, doc.id)
  }
  return null
}

// AC-08 — unit-capacity warning (#1105, edge, NON-BLOCKING). Surface a warning
// for any unit (`professional.unitIds`) the removed member belonged to that now
// has ZERO active professionals. Bookings on those units would have no slots —
// the owner must be told (never a silent gap), but it does NOT block the removal.
//
// Reads ALL professionals for the org (no `operationalStatus` index filter — that
// raced the just-committed `professional.suspended` write) and excludes the
// removed projection EXPLICITLY by id, so it never counts itself as staffing
// regardless of read-after-write timing. Active = `operationalStatus == 'operational'`.
// Within-org read; small set. Read-only.
async function detectUnitsLeftWithoutProfessional(
  orgId: string,
  removedProfessionalId: string,
  removedUnitIds: readonly string[],
): Promise<string[]> {
  if (removedUnitIds.length === 0) return []
  const snap = await getAdminFirestore()
    .collection('orgs')
    .doc(orgId)
    .collection('professionals')
    .withConverter(fsConverter(StoredProfessional))
    .get()
  const stillStaffed = new Set<string>()
  for (const doc of snap.docs) {
    if (doc.id === removedProfessionalId) continue
    const pro = doc.data()
    if (pro.operationalStatus !== 'operational') continue
    for (const unitId of pro.unitIds ?? []) stillStaffed.add(unitId)
  }
  return [...new Set(removedUnitIds)].filter((unitId) => !stillStaffed.has(unitId)).sort()
}

// Cascade steps stacked by #1104/#1105, in saga order. Each is event-first +
// idempotent; a non-null return aborts the saga (caller compensates the
// membership-end + surfaces it — never a silent partial). The AC-05 open-comanda
// veto is NOT here — it's a pre-flight in `offboardMemberInOrg` that runs
// BEFORE the membership is ended (settlement-first). There is NO commission veto
// (AC-06 revised: off-system settlement). #1105 appends the AC-09 pending-invite
// cleanup here; the
// AC-08 unit-capacity warning is computed by the saga (non-blocking signal, not a
// cascade abort).
async function runOffboardingCascade(
  orgId: string,
  professionalId: string | null,
  targetUserId: string,
  actorId: string,
): Promise<string | null> {
  // #1104 steps key on the professional DOC id; the AC-09 invite cleanup keys on
  // the member email and runs regardless of a projection (a non-professional can
  // hold a pending invite too).
  if (professionalId) {
    const apptErr = await cancelFutureAppointments(orgId, professionalId, actorId)
    if (apptErr) return apptErr
    const blockErr = await cleanAgendaBlocks(orgId, professionalId, actorId)
    if (blockErr) return blockErr
  }
  const inviteErr = await cleanPendingInvites(orgId, targetUserId, actorId)
  if (inviteErr) return inviteErr
  return null
}

export async function offboardMemberInOrg(
  orgId: string,
  targetUserId: string,
  actorId: string,
): Promise<OffboardResult> {
  const db = getAdminFirestore()
  const membershipId = membershipDocId(orgId, targetUserId)
  const memberSnap = await db
    .collection('memberships')
    .doc(membershipId)
    .withConverter(fsConverter(Membership))
    .get()
  const member = memberSnap.data()
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

  // Step 1 — END MEMBERSHIP/ACCESS (AC-10). Event-first: `membership.updated`
  // carrying ONLY `status` (the reducer projects it; replay reconstructs from
  // the stream alone). Role/permissions untouched. `revoked` is terminal.
  const ended = await emitEvent(MembershipConfig, `memberships/${membershipId}`, {
    _tag: 'membership.updated',
    actorId,
    payload: { changes: { status: 'revoked' } },
  })
  if (!ended.ok) return { ok: false, error: ended.error }

  // Compensation for step 1 — restore the prior status so a failed downstream
  // step never leaves the member half-offboarded silently.
  const compensateMembership = async (): Promise<void> => {
    await emitEvent(MembershipConfig, `memberships/${membershipId}`, {
      _tag: 'membership.updated',
      actorId,
      payload: { changes: { status: previousStatus } },
    }).catch(() => undefined)
  }

  // Step 2 — DEACTIVATE the professional projection (if the member has one).
  // Reuses the non-destructive demotion event: `professional.suspended` projects
  // approval→`pending`, dropping it off the public agenda/catalog. NOT
  // `professional.deleted`; the projection + its `professionals_pii` are RETAINED
  // IDENTIFIABLE (art. 16). Idempotent — an already-suspended projection re-emits
  // harmlessly.
  const proSnap = await db
    .collection('orgs')
    .doc(orgId)
    .collection('professionals')
    .where('userId', '==', targetUserId)
    .limit(1)
    .withConverter(fsConverter(StoredProfessional))
    .get()
  const existingPro = proSnap.docs[0]
  // Snapshot the member's units BEFORE deactivation (AC-08): after the projection
  // flips to `pending`, these are the units that may now be unstaffed.
  const removedUnitIds = existingPro ? (existingPro.data()?.unitIds ?? []) : []
  if (existingPro) {
    const suspended = await emitEvent(
      ProfessionalConfig,
      `orgs/${orgId}/professionals/${existingPro.id}`,
      { _tag: 'professional.suspended', actorId, payload: {} },
    )
    if (!suspended.ok) {
      await compensateMembership()
      return { ok: false, error: suspended.error }
    }
  }

  // Step 3+ — cascade hooks (#1104: cancel future appointments + clean
  // agenda-blocks, keyed on the professional DOC id; #1105: clean pending invites,
  // keyed on the member email). A non-null return is an error: compensate the
  // membership-end + surface it (no silent partial).
  const cascadeErr = await runOffboardingCascade(
    orgId,
    existingPro?.id ?? null,
    targetUserId,
    actorId,
  )
  if (cascadeErr) {
    await compensateMembership()
    return { ok: false, error: cascadeErr }
  }

  // AC-08 — non-blocking unit-capacity warning. Computed AFTER deactivation (so
  // the just-removed member no longer counts as staffing its units). Surfaced in
  // the result, never a veto: bookings on an unstaffed unit simply have no slots.
  const unitsWithoutProfessional = existingPro
    ? await detectUnitsLeftWithoutProfessional(orgId, existingPro.id, removedUnitIds)
    : []
  const warnings: OffboardWarning[] =
    unitsWithoutProfessional.length > 0
      ? [{ kind: 'unit-without-professional', unitIds: unitsWithoutProfessional }]
      : []

  return { ok: true, warnings }
}
