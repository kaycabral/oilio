import { Membership, membershipDocId } from '@/domain'
import { getAdminFirestore } from '@/shared/db'
import { fsConverter } from '@/shared/db/converter'
import { Schema } from 'effect'
import 'server-only'

// Minimal projection for the customer/appointment loops — they only need each
// doc's `orgId`. The membership recreate spreads the FULL doc, so that loop
// decodes against the complete `Membership` schema instead.
const OrgIdProbe = Schema.Struct({ orgId: Schema.String })

// Reconciles a "stub" User (created by the recepcionista path with random
// UUID and `claimedAt: null`) into a freshly-claimed OAuth user when the
// completion step (#838) discovers that both records share the same
// WhatsApp. Re-points every FK that referenced the stub and deletes the
// stub doc. Schema decision: [[02-Estrategia-Modelo-Identidade]] (#832).
//
// CollectionGroup queries are used here intentionally — the merge is an
// admin-only identity-reconciliation path that's inherently cross-org,
// and the `customerUserId` field on Appointment was denormalized in #832
// for exactly this kind of lookup. The "no cross-org CG queries" rule
// (CLAUDE.md) applies to operational product code, not to this path.
//
// Conflict resolution:
//
//   - Customer in a org where the claimer already has one → the stub's
//     Customer doc is dropped (the claimer's wins; the stub never had
//     anything beyond the recepcionista's typed PII).
//   - Membership in a org where the claimer already has one → ditto.
//   - Appointments are always re-pointed (1-to-1 field update; no conflict).
//
// Idempotent on no-op: if the stub has no references, only the audit log
// and the stub deletion happen.

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

  const db = getAdminFirestore()
  const now = new Date().toISOString()
  const orgsTouched = new Set<string>()

  let customersRepointed = 0
  let customersDropped = 0
  let membershipsRepointed = 0
  let membershipsDropped = 0
  let appointmentsRepointed = 0

  // 1. Customers — collectionGroup gives us every Customer shadow that
  //    points to the stub, across every org.
  const stubCustomers = await db
    .collectionGroup('customers')
    .where('userId', '==', input.stubUid)
    .withConverter(fsConverter(OrgIdProbe))
    .get()
  for (const stubDoc of stubCustomers.docs) {
    const orgId = stubDoc.data().orgId
    orgsTouched.add(orgId)
    const claimerExisting = await db
      .collection('orgs')
      .doc(orgId)
      .collection('customers')
      .where('userId', '==', input.claimerUid)
      .limit(1)
      .get()
    if (claimerExisting.empty) {
      await stubDoc.ref.update({ userId: input.claimerUid, updatedAt: now })
      customersRepointed++
    } else {
      await stubDoc.ref.delete()
      customersDropped++
    }
  }

  // 2. Memberships — top-level, doc id is `{orgId}_{userId}` so we
  //    can't update in place; we recreate at the claimer's id and delete
  //    the stub doc.
  const stubMemberships = await db
    .collection('memberships')
    .where('userId', '==', input.stubUid)
    .withConverter(fsConverter(Membership))
    .get()
  for (const stubDoc of stubMemberships.docs) {
    const data = stubDoc.data()
    orgsTouched.add(data.orgId)
    const claimerRef = db
      .collection('memberships')
      .doc(membershipDocId(data.orgId, input.claimerUid))
    const claimerExisting = await claimerRef.get()
    if (claimerExisting.exists) {
      await stubDoc.ref.delete()
      membershipsDropped++
    } else {
      await claimerRef.set({ ...data, id: claimerRef.id, userId: input.claimerUid, updatedAt: now })
      await stubDoc.ref.delete()
      membershipsRepointed++
    }
  }

  // 3. Appointments — re-point customerUserId across every org.
  const stubAppointments = await db
    .collectionGroup('appointments')
    .where('customerUserId', '==', input.stubUid)
    .withConverter(fsConverter(OrgIdProbe))
    .get()
  for (const stubDoc of stubAppointments.docs) {
    orgsTouched.add(stubDoc.data().orgId)
    await stubDoc.ref.update({ customerUserId: input.claimerUid, updatedAt: now })
    appointmentsRepointed++
  }

  // 4. Drop the stub User doc — every FK has been re-pointed.
  await db.collection('users').doc(input.stubUid).delete()

  // Sem audit_logs: `customer`/`membership` são CRUD (ADR 0010), o merge é
  // operação de manutenção de identidade. O resultado (contagens + orgs
  // tocados) é o registro do que mudou — devolvido ao chamador.
  return {
    customersRepointed,
    customersDropped,
    membershipsRepointed,
    membershipsDropped,
    appointmentsRepointed,
    orgsTouched: Array.from(orgsTouched),
  }
}
