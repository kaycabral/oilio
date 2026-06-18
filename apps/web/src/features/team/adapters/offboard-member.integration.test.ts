// Integration test for the member offboarding saga core (#1103 / brief 0041
// AC-04 + AC-10). Runs against the Firestore emulator via the admin SDK — no
// mocks. The saga ends the membership (terminal `revoked`), deactivates the
// professional projection (non-destructive), and RETAINS the vínculo PII
// (art. 16). Re-running is idempotent (no throw, no double-event). The owner is
// never offboarded.
//
// Every fixture uses a per-run-unique org/user id (Date.now + counter); we
// never wipe globally and read only our own ids.

import { describe, expect, it, vi } from 'vitest'

vi.mock('next/headers', () => ({
  headers: () => Promise.resolve({ get: () => null }),
}))

import { defaultPermissionsForRole, membershipDocId } from '@/domain'
import { getAdminFirestore } from '@/shared/db'
import { buildUser } from '@/shared/fixtures/domain-builders'
import { offboardMemberInOrg } from './offboard-member'

const db = getAdminFirestore()

// Reads an optional string field off a Firestore doc with a runtime check,
// avoiding an unsafe `as` cast on the loosely-typed `DocumentData`.
function readOptionalStringField(
  data: FirebaseFirestore.DocumentData | undefined,
  field: string,
): string | undefined {
  const value: unknown = data?.[field]
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new Error(`expected string field "${field}"`)
  return value
}

let seq = 0
function uniqueId(prefix: string): string {
  seq += 1
  return `${prefix}-${Date.now()}-${seq}`
}

async function seedMembership(
  orgId: string,
  userId: string,
  role: 'owner' | 'professional' | 'receptionist',
): Promise<string> {
  const id = membershipDocId(orgId, userId)
  const now = new Date().toISOString()
  await db
    .collection('memberships')
    .doc(id)
    .set({
      id,
      orgId,
      userId,
      role,
      status: 'active',
      invitedBy: null,
      joinedAt: now,
      updatedAt: now,
      unitId: null,
      commissionRate: null,
      permissions: defaultPermissionsForRole(role),
      _version: 1,
    })
  return id
}

async function seedProfessional(orgId: string, userId: string): Promise<string> {
  const ref = db.collection('orgs').doc(orgId).collection('professionals').doc()
  const now = new Date().toISOString()
  await ref.set({
    id: ref.id,
    orgId,
    userId,
    operationalStatus: 'operational',
    defaultCommission: null,
    unitIds: [],
    serviceIds: [],
    createdAt: now,
    updatedAt: now,
    _version: 1,
  })
  // Vínculo PII — must survive the offboarding (retention, art. 16).
  await db
    .collection('orgs')
    .doc(orgId)
    .collection('professionals_pii')
    .doc(ref.id)
    .set({ taxIdentity: null })
  return ref.id
}

async function seedProfessionalWithUnits(
  orgId: string,
  userId: string,
  unitIds: string[],
): Promise<string> {
  const ref = db.collection('orgs').doc(orgId).collection('professionals').doc()
  const now = new Date().toISOString()
  await ref.set({
    id: ref.id,
    orgId,
    userId,
    operationalStatus: 'operational',
    defaultCommission: null,
    unitIds,
    serviceIds: [],
    createdAt: now,
    updatedAt: now,
    _version: 1,
  })
  await db
    .collection('orgs')
    .doc(orgId)
    .collection('professionals_pii')
    .doc(ref.id)
    .set({ taxIdentity: null })
  return ref.id
}

async function seedUser(userId: string, email: string): Promise<void> {
  await db
    .collection('users')
    .doc(userId)
    .set(buildUser(userId, new Date().toISOString(), { email, displayName: 'Member' }))
}

async function seedCommission(
  orgId: string,
  attributedUserId: string,
  liquidationStatus: 'pendente' | 'pago',
  amountCents: number,
): Promise<string> {
  const ref = db.collection('orgs').doc(orgId).collection('commissions').doc()
  const now = new Date().toISOString()
  await ref.set({
    id: ref.id,
    orgId,
    orderId: 'order-1',
    orderItemId: 'item-1',
    attributedUserId,
    itemKind: 'service',
    itemName: 'Corte',
    itemTotalCents: amountCents * 2,
    commissionKind: 'percentage',
    commissionValue: 50,
    amountCents,
    liquidationStatus,
    paidAt: liquidationStatus === 'pago' ? now : null,
    paymentProof: null,
    createdAt: now,
  })
  return ref.id
}

async function seedInvite(
  orgId: string,
  email: string,
  status: 'pending' | 'accepted' = 'pending',
): Promise<string> {
  const ref = db.collection('orgs').doc(orgId).collection('invites').doc()
  const now = new Date().toISOString()
  await ref.set({
    id: ref.id,
    orgId,
    role: 'professional',
    tokenHash: 'hash',
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString(),
    status,
    invitedBy: 'owner-1',
    acceptedByUid: status === 'accepted' ? 'someone' : null,
    acceptedAt: status === 'accepted' ? now : null,
    createdAt: now,
    updatedAt: now,
    _version: 1,
  })
  await db.collection('orgs').doc(orgId).collection('invites_pii').doc(ref.id).set({ email })
  return ref.id
}

async function inviteExists(orgId: string, inviteId: string): Promise<boolean> {
  const snap = await db.collection('orgs').doc(orgId).collection('invites').doc(inviteId).get()
  return snap.exists
}

async function invitePiiExists(orgId: string, inviteId: string): Promise<boolean> {
  const snap = await db.collection('orgs').doc(orgId).collection('invites_pii').doc(inviteId).get()
  return snap.exists
}

async function seedAppointment(
  orgId: string,
  professionalId: string,
  startAt: string,
  status: 'scheduled' | 'completed' = 'scheduled',
): Promise<string> {
  const ref = db.collection('orgs').doc(orgId).collection('appointments').doc()
  const now = new Date().toISOString()
  await ref.set({
    id: ref.id,
    orgId,
    unitId: 'unit-1',
    professionalId,
    customerId: 'cust-1',
    serviceId: 'svc-1',
    startAt,
    endAt: new Date(new Date(startAt).getTime() + 30 * 60_000).toISOString(),
    status,
    notes: null,
    servicePriceCentsSnapshot: 1000,
    serviceDurationMinutesSnapshot: 30,
    commissionSnapshot: null,
    cancellationPolicySnapshot: null,
    customerUserId: 'cust-user-1',
    professionalUserId: null,
    createdAt: now,
    updatedAt: now,
    _version: 1,
  })
  return ref.id
}

async function seedAgendaBlock(orgId: string, professionalId: string | null): Promise<string> {
  const ref = db.collection('orgs').doc(orgId).collection('agenda_blocks').doc()
  const now = new Date().toISOString()
  await ref.set({
    id: ref.id,
    orgId,
    kind: 'one_off',
    unitId: 'unit-1',
    professionalId,
    reason: 'férias',
    weekday: null,
    open: null,
    close: null,
    startAt: now,
    endAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    createdAt: now,
    updatedAt: now,
    _version: 1,
  })
  return ref.id
}

async function seedOpenOrder(
  orgId: string,
  attributedUserId: string,
  status: 'open' | 'closed' = 'open',
): Promise<string> {
  const ref = db.collection('orgs').doc(orgId).collection('orders').doc()
  const now = new Date().toISOString()
  await ref.set({
    id: ref.id,
    orgId,
    unitId: 'unit-1',
    customerId: 'cust-1',
    appointmentId: null,
    status,
    items: [
      {
        id: 'item-1',
        kind: 'service',
        refId: 'svc-1',
        name: 'Corte',
        quantity: 1,
        unitPriceCents: 1000,
        commission: null,
        attributedUserId,
      },
    ],
    discountCents: 0,
    notes: null,
    closedAt: status === 'closed' ? now : null,
    paymentMethod: null,
    subtotalCents: 1000,
    totalCents: 1000,
    createdAt: now,
    updatedAt: now,
    _version: 1,
  })
  return ref.id
}

async function readAppointmentStatus(orgId: string, apptId: string): Promise<string | undefined> {
  const snap = await db.collection('orgs').doc(orgId).collection('appointments').doc(apptId).get()
  return (snap.data() as { status?: string } | undefined)?.status
}

async function blockExists(orgId: string, blockId: string): Promise<boolean> {
  const snap = await db.collection('orgs').doc(orgId).collection('agenda_blocks').doc(blockId).get()
  return snap.exists
}

const FUTURE = new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString()
const PAST = new Date(Date.now() - 7 * 24 * 60 * 60_000).toISOString()

async function readStatus(membershipId: string): Promise<string | undefined> {
  const snap = await db.collection('memberships').doc(membershipId).get()
  return (snap.data() as { status?: string } | undefined)?.status
}

async function readApproval(orgId: string, professionalId: string): Promise<string | undefined> {
  const snap = await db
    .collection('orgs')
    .doc(orgId)
    .collection('professionals')
    .doc(professionalId)
    .get()
  return (snap.data() as { operationalStatus?: string } | undefined)?.operationalStatus
}

async function piiExists(orgId: string, professionalId: string): Promise<boolean> {
  const snap = await db
    .collection('orgs')
    .doc(orgId)
    .collection('professionals_pii')
    .doc(professionalId)
    .get()
  return snap.exists
}

async function countStatusEvents(membershipId: string, status: string): Promise<number> {
  const snap = await db.collection('memberships').doc(membershipId).collection('events').get()
  return snap.docs.filter((d) => {
    const data = d.data() as {
      _tag?: string
      payload?: { changes?: { status?: string } }
    }
    return data._tag === 'membership.updated' && data.payload?.changes?.status === status
  }).length
}

describe('offboardMemberInOrg (#1103)', () => {
  it('ends membership (revoked), deactivates professional, RETAINS PII', async () => {
    const orgId = uniqueId('org')
    const userId = uniqueId('user')
    const actorId = uniqueId('actor')
    const membershipId = await seedMembership(orgId, userId, 'professional')
    const proId = await seedProfessional(orgId, userId)

    const res = await offboardMemberInOrg(orgId, userId, actorId)
    expect(res.ok).toBe(true)

    // AC-10: terminal revoked status (event-sourced).
    expect(await readStatus(membershipId)).toBe('revoked')
    expect(await countStatusEvents(membershipId, 'revoked')).toBe(1)

    // Professional projection DEACTIVATED (not deleted): off the public agenda.
    const snap = await db.collection('orgs').doc(orgId).collection('professionals').doc(proId).get()
    expect(snap.exists).toBe(true)
    expect(await readApproval(orgId, proId)).not.toBe('operational')

    // RETENTION (art. 16): the vínculo PII is RETAINED — never scrubbed.
    expect(await piiExists(orgId, proId)).toBe(true)
  })

  it('is idempotent — re-running is a no-op (no throw, no double-event)', async () => {
    const orgId = uniqueId('org')
    const userId = uniqueId('user')
    const actorId = uniqueId('actor')
    const membershipId = await seedMembership(orgId, userId, 'professional')
    const proId = await seedProfessional(orgId, userId)

    const first = await offboardMemberInOrg(orgId, userId, actorId)
    expect(first.ok).toBe(true)
    const second = await offboardMemberInOrg(orgId, userId, actorId)
    expect(second.ok).toBe(true)

    // Still revoked, still exactly ONE revoked event (the second run
    // short-circuits before emitting).
    expect(await readStatus(membershipId)).toBe('revoked')
    expect(await countStatusEvents(membershipId, 'revoked')).toBe(1)
    // PII still retained after the repeated run.
    expect(await piiExists(orgId, proId)).toBe(true)
  })

  it('refuses to offboard the owner', async () => {
    const orgId = uniqueId('org')
    const userId = uniqueId('user')
    const actorId = uniqueId('actor')
    const membershipId = await seedMembership(orgId, userId, 'owner')

    const res = await offboardMemberInOrg(orgId, userId, actorId)
    expect(res.ok).toBe(false)
    expect(await readStatus(membershipId)).toBe('active')
  })

  it('offboards a non-professional member (no projection to deactivate)', async () => {
    const orgId = uniqueId('org')
    const userId = uniqueId('user')
    const actorId = uniqueId('actor')
    const membershipId = await seedMembership(orgId, userId, 'receptionist')

    const res = await offboardMemberInOrg(orgId, userId, actorId)
    expect(res.ok).toBe(true)
    expect(await readStatus(membershipId)).toBe('revoked')
  })
})

describe('offboardMemberInOrg — cascade (#1104, brief 0041 AC-02/AC-05/AC-07)', () => {
  it('AC-02: cancels FUTURE appointments (status flips, doc RETAINED struck-through), LEAVES past', async () => {
    const orgId = uniqueId('org')
    const userId = uniqueId('user')
    const actorId = uniqueId('actor')
    await seedMembership(orgId, userId, 'professional')
    const proId = await seedProfessional(orgId, userId)
    const futureAppt = await seedAppointment(orgId, proId, FUTURE)
    const pastAppt = await seedAppointment(orgId, proId, PAST)

    const res = await offboardMemberInOrg(orgId, userId, actorId)
    expect(res.ok).toBe(true)

    // Future appointment is CANCELLED — but RETAINED (the doc still exists;
    // the agenda grid renders it struck-through, it does NOT vanish).
    expect(await readAppointmentStatus(orgId, futureAppt)).toBe('cancelled')
    const futureSnap = await db
      .collection('orgs')
      .doc(orgId)
      .collection('appointments')
      .doc(futureAppt)
      .get()
    expect(futureSnap.exists).toBe(true)

    // Past appointment is LEFT untouched.
    expect(await readAppointmentStatus(orgId, pastAppt)).toBe('scheduled')
  })

  it('AC-07: removes the professional agenda-blocks, LEAVES org-wide blocks', async () => {
    const orgId = uniqueId('org')
    const userId = uniqueId('user')
    const actorId = uniqueId('actor')
    await seedMembership(orgId, userId, 'professional')
    const proId = await seedProfessional(orgId, userId)
    const proBlock = await seedAgendaBlock(orgId, proId)
    const orgBlock = await seedAgendaBlock(orgId, null)

    const res = await offboardMemberInOrg(orgId, userId, actorId)
    expect(res.ok).toBe(true)

    expect(await blockExists(orgId, proBlock)).toBe(false)
    // Org-wide block (professionalId == null) is NOT the member's — kept.
    expect(await blockExists(orgId, orgBlock)).toBe(true)
  })

  it('AC-05: REFUSES while an open comanda is attributed to the member (saga not started)', async () => {
    const orgId = uniqueId('org')
    const userId = uniqueId('user')
    const actorId = uniqueId('actor')
    const membershipId = await seedMembership(orgId, userId, 'professional')
    const proId = await seedProfessional(orgId, userId)
    const futureAppt = await seedAppointment(orgId, proId, FUTURE)
    await seedOpenOrder(orgId, userId)

    const res = await offboardMemberInOrg(orgId, userId, actorId)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/comanda aberta/i)

    // Veto runs BEFORE any mutation: membership intact, appointment untouched.
    expect(await readStatus(membershipId)).toBe('active')
    expect(await readAppointmentStatus(orgId, futureAppt)).toBe('scheduled')
  })

  it('AC-05: a CLOSED comanda does NOT block (only open vetoes)', async () => {
    const orgId = uniqueId('org')
    const userId = uniqueId('user')
    const actorId = uniqueId('actor')
    const membershipId = await seedMembership(orgId, userId, 'professional')
    await seedProfessional(orgId, userId)
    await seedOpenOrder(orgId, userId, 'closed')

    const res = await offboardMemberInOrg(orgId, userId, actorId)
    expect(res.ok).toBe(true)
    expect(await readStatus(membershipId)).toBe('revoked')
  })

  it('AC-05: an open comanda attributed to ANOTHER member does NOT block', async () => {
    const orgId = uniqueId('org')
    const userId = uniqueId('user')
    const otherUserId = uniqueId('user')
    const actorId = uniqueId('actor')
    const membershipId = await seedMembership(orgId, userId, 'professional')
    await seedProfessional(orgId, userId)
    await seedOpenOrder(orgId, otherUserId)

    const res = await offboardMemberInOrg(orgId, userId, actorId)
    expect(res.ok).toBe(true)
    expect(await readStatus(membershipId)).toBe('revoked')
  })

  it('idempotent re-run: cascade is safe to repeat (no throw, blocks already gone)', async () => {
    const orgId = uniqueId('org')
    const userId = uniqueId('user')
    const actorId = uniqueId('actor')
    await seedMembership(orgId, userId, 'professional')
    const proId = await seedProfessional(orgId, userId)
    const futureAppt = await seedAppointment(orgId, proId, FUTURE)
    const proBlock = await seedAgendaBlock(orgId, proId)

    const first = await offboardMemberInOrg(orgId, userId, actorId)
    expect(first.ok).toBe(true)
    const second = await offboardMemberInOrg(orgId, userId, actorId)
    expect(second.ok).toBe(true)

    expect(await readAppointmentStatus(orgId, futureAppt)).toBe('cancelled')
    expect(await blockExists(orgId, proBlock)).toBe(false)
  })
})

describe('offboardMemberInOrg — commissions/capacity/invites (#1105, brief 0041 AC-06/AC-08/AC-09)', () => {
  // AC-06 (revised — commit 308146f, MR !1111 rejected): the offboarding does NOT
  // veto or warn on pending commissions. The "acerto entre as partes" is an
  // off-system settlement between the parties. The member's commissions — pending
  // or paid — are LEFT untouched: identifiable, retained, attributed to the real
  // userId in reports. NO anonymization, NO neutralization.
  it('AC-06: SUCCEEDS even with pending commissions — they are LEFT pending + identifiable', async () => {
    const orgId = uniqueId('org')
    const userId = uniqueId('user')
    const actorId = uniqueId('actor')
    const membershipId = await seedMembership(orgId, userId, 'professional')
    await seedProfessional(orgId, userId)
    const pendingId1 = await seedCommission(orgId, userId, 'pendente', 1500)
    const pendingId2 = await seedCommission(orgId, userId, 'pendente', 1000)
    const paidId = await seedCommission(orgId, userId, 'pago', 9999)

    const res = await offboardMemberInOrg(orgId, userId, actorId)
    // No veto: the removal goes through despite the pending commissions.
    expect(res.ok).toBe(true)
    expect(await readStatus(membershipId)).toBe('revoked')

    // The commissions are ALL untouched — pending stay pending, attribution to
    // the member's real userId is retained (resolves to the real name in reports).
    for (const id of [pendingId1, pendingId2, paidId]) {
      const commSnap = await db
        .collection('orgs')
        .doc(orgId)
        .collection('commissions')
        .doc(id)
        .get()
      expect(commSnap.exists).toBe(true)
      expect(readOptionalStringField(commSnap.data(), 'attributedUserId')).toBe(userId)
    }
    const pending1 = await db
      .collection('orgs')
      .doc(orgId)
      .collection('commissions')
      .doc(pendingId1)
      .get()
    expect(readOptionalStringField(pending1.data(), 'liquidationStatus')).toBe('pendente')
  })

  it('AC-08: warns when removal leaves a unit with 0 active professionals', async () => {
    const orgId = uniqueId('org')
    const userId = uniqueId('user')
    const actorId = uniqueId('actor')
    await seedMembership(orgId, userId, 'professional')
    await seedProfessionalWithUnits(orgId, userId, ['unit-solo'])

    const res = await offboardMemberInOrg(orgId, userId, actorId)
    expect(res.ok).toBe(true)
    if (res.ok) {
      const warn = res.warnings.find((w) => w.kind === 'unit-without-professional')
      expect(warn?.unitIds).toEqual(['unit-solo'])
    }
  })

  it('AC-08: does NOT warn when another active professional still staffs the unit', async () => {
    const orgId = uniqueId('org')
    const userId = uniqueId('user')
    const otherUserId = uniqueId('user')
    const actorId = uniqueId('actor')
    await seedMembership(orgId, userId, 'professional')
    await seedProfessionalWithUnits(orgId, userId, ['unit-shared'])
    // Another approved professional remains on the same unit.
    await seedProfessionalWithUnits(orgId, otherUserId, ['unit-shared'])

    const res = await offboardMemberInOrg(orgId, userId, actorId)
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.warnings).toEqual([])
  })

  it('AC-09: cleans the member PENDING invite (matched by email) + its PII, leaves accepted', async () => {
    const orgId = uniqueId('org')
    const userId = uniqueId('user')
    const actorId = uniqueId('actor')
    const email = `${uniqueId('member')}@example.com`
    await seedMembership(orgId, userId, 'professional')
    await seedProfessional(orgId, userId)
    await seedUser(userId, email)
    const pendingInvite = await seedInvite(orgId, email, 'pending')
    const otherInvite = await seedInvite(orgId, `${uniqueId('other')}@example.com`, 'pending')
    const acceptedInvite = await seedInvite(orgId, email, 'accepted')

    const res = await offboardMemberInOrg(orgId, userId, actorId)
    expect(res.ok).toBe(true)

    // The member's pending invite + its PII are gone.
    expect(await inviteExists(orgId, pendingInvite)).toBe(false)
    expect(await invitePiiExists(orgId, pendingInvite)).toBe(false)
    // Another member's pending invite is untouched.
    expect(await inviteExists(orgId, otherInvite)).toBe(true)
    // An accepted (historical) invite for the same email is LEFT.
    expect(await inviteExists(orgId, acceptedInvite)).toBe(true)
  })

  it('AC-09: idempotent — re-running finds no pending invite to clean', async () => {
    const orgId = uniqueId('org')
    const userId = uniqueId('user')
    const actorId = uniqueId('actor')
    const email = `${uniqueId('member')}@example.com`
    await seedMembership(orgId, userId, 'professional')
    await seedProfessional(orgId, userId)
    await seedUser(userId, email)
    const pendingInvite = await seedInvite(orgId, email, 'pending')

    const first = await offboardMemberInOrg(orgId, userId, actorId)
    expect(first.ok).toBe(true)
    const second = await offboardMemberInOrg(orgId, userId, actorId)
    expect(second.ok).toBe(true)
    expect(await inviteExists(orgId, pendingInvite)).toBe(false)
  })
})
