import { Membership, membershipDocId } from '@/domain'
import { AppointmentConfig, CustomerConfig, MembershipConfig } from '@/domain/aggregates'
import { appendDeleteToTx, appendEventToTx, type TransactionContext } from '@/domain/effect'
import {
  rowToDoc as membershipRowToDoc,
  type MembershipRow,
} from '@/shared/db/pg/effect/membership-projector'
import { readAsSubject, readUnderRls } from '@/shared/db/pg/rls-read'
import { deleteUser } from '@/shared/db/pg/users-store'
import { commitSaga, emitEvent } from '@/shared/effect-bridge'
import { listLinkedOrgIds } from '@/shared/identity/org-links'
import { Schema } from 'effect'
import 'server-only'

const decodeMembership = Schema.decodeUnknownSync(Membership)

// Reconciles a "stub" User (created by the recepcionista path with random
// UUID and `claimedAt: null`) into a freshly-claimed OAuth user when the
// completion step (#838) discovers that both records share the same
// WhatsApp. Re-points every FK that referenced the stub and deletes the
// stub user row. Schema decision: [[02-Estrategia-Modelo-Identidade]] (#832).
//
// Post-cutover (#1202) this runs on Postgres — there is NO `collectionGroup`.
// The identity layer enumerates the stub's orgs WITHOUT a cross-org query
// (ADR 0004), mirroring `anonymizeAccount`'s `enumerateSubjectOrgs`: the union
// of the per-subject `org_links` reverse index (every org the stub is a
// CUSTOMER of — written as a saga step on customer creation) + the stub's own
// `memberships` (per-subject RLS, keyed by `user_id`). A
// booked appointment's `customerUserId` always implies a Customer in the same
// org (booking creates the customer → its `org_links` row first), so the
// customer-org set covers the appointment FK too — the same coverage the LGPD
// erasure cascade (`eraseCustomerCascadeInOrg`) relies on.
//
// State changes go through DOMAIN EVENTS, never a raw projection UPDATE
// (web/CLAUDE.md "no state change without an event"):
//
//   - Customer/Appointment carry `userId`/`customerUserId` in their `*.updated`
//     partial; a repoint is an `*.updated` event with that one field changed.
//   - A dropped Customer/Membership is a `*.deleted` event that also hard-deletes
//     the read-model row (`appendDeleteToTx`).
//   - A re-pointed Membership can't change in place (doc id is `{orgId}_{userId}`):
//     `membership.created` at the claimer's id + `membership.deleted` at the
//     stub's id run as ONE ACID saga (`commitSaga`) so the move is atomic.
//
// Conflict resolution (unchanged from the Firestore path):
//
//   - Customer in an org where the claimer already has one → the stub's Customer
//     is dropped (the claimer's wins; the stub never had anything beyond the
//     recepcionista's typed PII).
//   - Membership in an org where the claimer already has one → ditto.
//   - Appointments are always re-pointed (1-to-1 field update; no conflict).
//
// Idempotent on no-op: if the stub has no references, only the stub user row is
// deleted.

export type MergeStubUserInput = {
  stubUid: string
  claimerUid: string
}

export type MergeStubUserResult = {
  customersRepointed: number
  customersDropped: number
  membershipsRepointed: number
  membershipsDropped: number
  appointmentsRepointed: number
  orgsTouched: string[]
}

export async function mergeStubUserIntoClaimer(
  input: MergeStubUserInput,
): Promise<MergeStubUserResult> {
  if (input.stubUid === input.claimerUid) {
    return {
      customersRepointed: 0,
      customersDropped: 0,
      membershipsRepointed: 0,
      membershipsDropped: 0,
      appointmentsRepointed: 0,
      orgsTouched: [],
    }
  }

  const { stubUid, claimerUid } = input
  const orgsTouched = new Set<string>()

  // Enumerate the orgs the stub is reachable in WITHOUT a cross-org query
  // (ADR 0004), mirroring `anonymizeAccount`'s `enumerateSubjectOrgs`:
  //   (a) `org_links` — every org the stub is a CUSTOMER of (covers the customer
  //       AND the appointment FK: a booking always creates the customer first);
  //   (b) `memberships` — the stub's own membership rows (per-subject RLS).
  // Both are per-subject reads, never a banned cross-org query.
  const customerOrgIds = await listLinkedOrgIds(stubUid)
  const stubMembershipRows = await readAsSubject<MembershipRow>(stubUid, (client) =>
    client
      .query<MembershipRow>('SELECT * FROM memberships WHERE user_id = $1', [stubUid])
      .then((res) => res.rows),
  )

  // 1. Customers — repoint to the claimer unless the claimer already holds one in
  //    that org (then drop the stub's). The appointment loop reuses the SAME orgs.
  const customers = await mergeCustomers(customerOrgIds, stubUid, claimerUid, orgsTouched)
  // 2. Memberships — doc id is `{orgId}_{userId}`, so no in-place repoint: drop or
  //    recreate-at-claimer + delete-stub (one ACID saga — the move is atomic).
  const memberships = await mergeMemberships(stubMembershipRows, claimerUid, orgsTouched)
  // 3. Appointments — always repoint `customerUserId`. The org set is the customer
  //    set (a booked appointment implies a customer in the org).
  const appointmentsRepointed = await mergeAppointments(
    customerOrgIds,
    stubUid,
    claimerUid,
    orgsTouched,
  )

  // 4. Drop the stub User row — every FK has been re-pointed. Non-aggregate
  //    (global auth row, not event-sourced), so it lands after the events.
  await deleteUser(stubUid)

  return {
    customersRepointed: customers.repointed,
    customersDropped: customers.dropped,
    membershipsRepointed: memberships.repointed,
    membershipsDropped: memberships.dropped,
    appointmentsRepointed,
    orgsTouched: Array.from(orgsTouched),
  }
}

async function mergeCustomers(
  orgIds: string[],
  stubUid: string,
  claimerUid: string,
  orgsTouched: Set<string>,
): Promise<{ repointed: number; dropped: number }> {
  let repointed = 0
  let dropped = 0
  for (const orgId of orgIds) {
    const stubCustomerIds = await listCustomerIdsByUser(orgId, stubUid)
    if (stubCustomerIds.length === 0) continue
    orgsTouched.add(orgId)
    const claimerHasCustomer = (await listCustomerIdsByUser(orgId, claimerUid)).length > 0
    for (const customerId of stubCustomerIds) {
      if (claimerHasCustomer) {
        await dropCustomer(orgId, customerId, claimerUid)
        dropped++
      } else {
        await repointCustomer(orgId, customerId, claimerUid)
        repointed++
      }
    }
  }
  return { repointed, dropped }
}

async function mergeMemberships(
  stubMembershipRows: MembershipRow[],
  claimerUid: string,
  orgsTouched: Set<string>,
): Promise<{ repointed: number; dropped: number }> {
  let repointed = 0
  let dropped = 0
  for (const row of stubMembershipRows) {
    const stub = decodeMembership(membershipRowToDoc(row))
    orgsTouched.add(stub.orgId)
    if (await claimerHasMembership(stub.orgId, claimerUid)) {
      await dropMembership(stub.orgId, stub.id, claimerUid)
      dropped++
    } else {
      await repointMembership(stub, claimerUid)
      repointed++
    }
  }
  return { repointed, dropped }
}

async function mergeAppointments(
  orgIds: string[],
  stubUid: string,
  claimerUid: string,
  orgsTouched: Set<string>,
): Promise<number> {
  let repointed = 0
  for (const orgId of orgIds) {
    const apptIds = await listAppointmentIdsByCustomer(orgId, stubUid)
    if (apptIds.length === 0) continue
    orgsTouched.add(orgId)
    for (const appointmentId of apptIds) {
      await repointAppointment(orgId, appointmentId, claimerUid)
      repointed++
    }
  }
  return repointed
}

// --- per-org reads (under org RLS) -----------------------------------------

async function listCustomerIdsByUser(orgId: string, userId: string): Promise<string[]> {
  const rows = await readUnderRls<{ id: string }>(orgId, (client) =>
    client
      .query<{
        id: string
      }>('SELECT id FROM customers WHERE org_id = $1 AND user_id = $2', [orgId, userId])
      .then((res) => res.rows),
  )
  return rows.map((r) => r.id)
}

async function listAppointmentIdsByCustomer(orgId: string, userId: string): Promise<string[]> {
  const rows = await readUnderRls<{ id: string }>(orgId, (client) =>
    client
      .query<{
        id: string
      }>('SELECT id FROM appointments WHERE org_id = $1 AND customer_user_id = $2', [orgId, userId])
      .then((res) => res.rows),
  )
  return rows.map((r) => r.id)
}

// Whether the claimer already holds a membership in the org — reads the
// membership projection under org RLS by its `{orgId}_{userId}` aggregate path.
async function claimerHasMembership(orgId: string, userId: string): Promise<boolean> {
  const rows = await readUnderRls<{ aggregate_path: string }>(orgId, (client) =>
    client
      .query<{
        aggregate_path: string
      }>('SELECT aggregate_path FROM memberships WHERE aggregate_path = $1 LIMIT 1', [
        `memberships/${membershipDocId(orgId, userId)}`,
      ])
      .then((res) => res.rows),
  )
  return rows.length > 0
}

// --- domain-event writes ----------------------------------------------------

async function repointCustomer(
  orgId: string,
  customerId: string,
  claimerUid: string,
): Promise<void> {
  const res = await emitEvent(CustomerConfig, `orgs/${orgId}/customers/${customerId}`, {
    _tag: 'customer.updated',
    actorId: claimerUid,
    payload: { changes: { userId: claimerUid } },
  })
  if (!res.ok) throw new Error(`Failed to repoint customer ${customerId}: ${res.error}`)
}

async function dropCustomer(orgId: string, customerId: string, claimerUid: string): Promise<void> {
  const path = `orgs/${orgId}/customers/${customerId}`
  const res = await commitSaga([
    (tx: TransactionContext) =>
      appendDeleteToTx(
        CustomerConfig,
        path,
        { _tag: 'customer.deleted', actorId: claimerUid, payload: {} },
        tx,
      ),
  ])
  if (!res.ok) throw new Error(`Failed to drop customer ${customerId}: ${res.error}`)
}

async function repointAppointment(
  orgId: string,
  appointmentId: string,
  claimerUid: string,
): Promise<void> {
  const res = await emitEvent(AppointmentConfig, `orgs/${orgId}/appointments/${appointmentId}`, {
    _tag: 'appointment.updated',
    actorId: claimerUid,
    payload: { changes: { customerUserId: claimerUid } },
  })
  if (!res.ok) throw new Error(`Failed to repoint appointment ${appointmentId}: ${res.error}`)
}

async function dropMembership(orgId: string, stubId: string, claimerUid: string): Promise<void> {
  const path = `memberships/${stubId}`
  const res = await commitSaga([
    (tx: TransactionContext) =>
      appendDeleteToTx(
        MembershipConfig,
        path,
        { _tag: 'membership.deleted', actorId: claimerUid, payload: {} },
        tx,
      ),
  ])
  if (!res.ok) throw new Error(`Failed to drop membership ${stubId}: ${res.error}`)
}

// Recreate at the claimer's id + delete the stub's, as ONE ACID saga so the
// membership never lands in a both/neither state.
async function repointMembership(stub: Membership, claimerUid: string): Promise<void> {
  const now = new Date().toISOString()
  const claimerId = membershipDocId(stub.orgId, claimerUid)
  const claimerMembership: Membership = {
    ...stub,
    id: claimerId,
    userId: claimerUid,
    updatedAt: now,
  }
  const res = await commitSaga([
    (tx: TransactionContext) =>
      appendEventToTx(
        MembershipConfig,
        `memberships/${claimerId}`,
        { _tag: 'membership.created', actorId: claimerUid, payload: { data: claimerMembership } },
        tx,
      ),
    (tx: TransactionContext) =>
      appendDeleteToTx(
        MembershipConfig,
        `memberships/${stub.id}`,
        { _tag: 'membership.deleted', actorId: claimerUid, payload: {} },
        tx,
      ),
  ])
  if (!res.ok) throw new Error(`Failed to repoint membership ${stub.id}: ${res.error}`)
}
