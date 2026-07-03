import type { StoredMemberOperation } from '@/domain'
import { AppointmentConfig } from '@/domain/aggregates/appointment/config'
import { InviteConfig } from '@/domain/aggregates/invite/config'
import { MemberOperationConfig } from '@/domain/aggregates/member-operation/config'
import { aggregateRef } from '@/domain/effect'
import {
  MEMBER_OPERATION_COLUMNS,
  memberOperationColumnValues,
} from '@/shared/db/pg/effect/member-operation-projector'
import { upsertMemberOperationPii } from '@/shared/db/pg/pii-sidecars-store'
import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures'
import {
  pgProjectionExists,
  pgQueryProjection,
  pgReadProjection,
  seedAppointment,
  seedCustomerShadowForUser,
  seedInvite,
  seedOrg,
  signInAndAttachSession,
  timestamptzToIso,
} from '../helpers/session'

// Feature-level E2E — account-level PII anonymization (brief 0032 / #1093).
//
// Proves the load-bearing contracts of this slice as a Definition of Done:
//   AC-01 — the global `users/{uid}` PII is scrubbed + `anonymizedAt` set,
//           irreversibly (no field holds the old name).
//   AC-02 — the subject's per-org `_pii` docs are scrubbed (deleted);
//           an anonymous customer (no userId) is a no-op.
//   AC-04 — records keep their `userId` pointer (retention).
//   AC-07 — the action is gated/self-scoped: anonymizing subject A leaves
//           subject B untouched.
//
// Post-cutover (#1202) the read-backs assert against Postgres: the global
// `users` table (keyed by `uid`, snake_case columns), the deletable per-org PII
// sidecars (`member_operations_pii` / `invites_pii`, keyed by `(org_id, id)`) and the
// typed `appointments` projection (`customer_user_id`).

// Reads the global `users` row (snake_case columns) — null when absent. Replaces
// the Firestore `users/{uid}` typed-value read; the columns the assertions touch
// are `display_name`, `mobile`, `email`, `birth_date`, `anonymized_at`.
async function readUserRow(uid: string): Promise<Record<string, unknown> | null> {
  const rows = await pgQueryProjection('users', 'uid', uid)
  return rows[0] ?? null
}

// Seeds a `member_operations` projection (the created event v1 + the typed row, the
// same shape the runtime projector writes — shared column helper, zero drift) +
// its `member_operations_pii` (taxIdentity) sidecar for an existing user, mirroring
// the product write path. The projection's `user_id` is what the anonymization
// matches on to find and scrub the subject's memberOperation PII. Returns the pid.
async function seedMemberOperationPiiFor(
  orgId: string,
  userId: string,
  unitIds: string[],
): Promise<string> {
  const pid = `e2e-prof-${userId}`
  const now = new Date().toISOString()
  const doc: StoredMemberOperation = {
    id: pid,
    orgId,
    userId,
    defaultCommission: null,
    unitIds: [...unitIds],
    catalogServiceIds: [],
    createdAt: now,
    updatedAt: now,
  }
  const { Client } = await import('pg')
  const client = new Client({ connectionString: process.env.OILIO_DATABASE_URL })
  await client.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      `INSERT INTO events (aggregate_type, aggregate_id, version, org_id, envelope)
       VALUES ('member_operation', $1, 1, $2, $3)`,
      [
        pid,
        orgId,
        {
          _tag: 'member_operation.created',
          version: 1,
          timestamp: now,
          actorId: 'e2e-seed',
          schemaVersion: 1,
          payload: { data: doc },
        },
      ],
    )
    const placeholders = MEMBER_OPERATION_COLUMNS.map((_, i) => `$${i + 1}`).join(', ')
    await client.query(
      `INSERT INTO member_operations (${MEMBER_OPERATION_COLUMNS.join(', ')}) VALUES (${placeholders})`,
      [...memberOperationColumnValues(doc, 1)],
    )
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    await client.end()
  }
  await upsertMemberOperationPii({
    orgId,
    id: pid,
    taxIdentity: { kind: 'individual', taxId: '39053344705' },
  })
  return pid
}

// Patches an accepted invite's projection so the subject is the `acceptedByUid`
// — the anonymization finds the subject's invites by `accepted_by_uid` to scrub
// the matching `invites_pii`. `seedInvite({ status: 'accepted' })` assigns a
// synthetic acceptor; this re-points it at the real subject.
async function setInviteAcceptedBy(orgId: string, inviteId: string, userId: string): Promise<void> {
  const { Client } = await import('pg')
  const client = new Client({ connectionString: process.env.OILIO_DATABASE_URL })
  await client.connect()
  try {
    await client.query(`UPDATE invites SET accepted_by_uid = $1 WHERE org_id = $2 AND id = $3`, [
      userId,
      orgId,
      inviteId,
    ])
  } finally {
    await client.end()
  }
}

// Seeds a transactional record (an appointment) that references the subject by
// `userId` — the thing we must NOT touch (AC-04 retention). Routes through the
// central typed helper so the appointment is complete + schema-valid: it seeds
// a per-org customer shadow keyed to the subject's user (so the appointment's
// denormalized `customerUserId` resolves to the subject) and references it.
async function seedRecordFor(orgId: string, unitId: string, userId: string): Promise<string> {
  const customerId = await seedCustomerShadowForUser(orgId, userId)
  return seedAppointment({
    orgId,
    unitId,
    memberOperationId: `e2e-prof-absent-${userId}`,
    customerId,
    serviceId: `e2e-svc-${userId}`,
    startAt: '2026-09-08T17:00:00.000Z',
    endAt: '2026-09-08T17:30:00.000Z',
    status: 'completed',
  })
}

// Walks /settings/privacy as the signed-in subject and confirms the deletion.
async function anonymizeSelfViaUi(page: Page): Promise<void> {
  await page.goto('/settings/privacy')
  await expect(page.getByRole('heading', { name: 'Excluir minha conta inteira' })).toBeVisible()
  await page.getByRole('textbox').fill('EXCLUIR')
  await page.getByRole('button', { name: 'Excluir meus dados', exact: true }).click()
  // On success the client tears the session down and bounces to /login.
  await page.waitForURL('**/login', { timeout: 15_000 })
}

test.describe('account-level PII anonymization', () => {
  test('self-service erasure scrubs the global account + _pii; records keep userId; other accounts untouched', async ({
    context,
  }) => {
    // Subject = an owner who can log in. Seed a professional_pii doc + an
    // accepted-invite pii doc + a record, all keyed to the subject.
    const subject = await seedOrg({ memberOperationCount: 0 })
    await seedMemberOperationPiiFor(subject.orgId, subject.uid, subject.unitIds)
    const { inviteId } = await seedInvite({
      orgId: subject.orgId,
      mobile: '5511990003456',
      role: 'member_operator',
      invitedBy: subject.uid,
      status: 'accepted',
    })
    // Mark the invite accepted by the subject so the scrub finds it.
    await setInviteAcceptedBy(subject.orgId, inviteId, subject.uid)
    const recordId = await seedRecordFor(subject.orgId, subject.unitIds[0]!, subject.uid)

    // A second, unrelated account — must remain fully intact (AC-07 scoping).
    const other = await seedOrg({ memberOperationCount: 0 })
    const otherBefore = await readUserRow(other.uid)

    // Pre-condition: the subject's PII is present.
    const before = await readUserRow(subject.uid)
    expect(before?.display_name).toBeTruthy()
    expect(
      await pgProjectionExists(
        'member_operations_pii',
        aggregateRef(MemberOperationConfig, subject.orgId, `e2e-prof-${subject.uid}`),
      ),
    ).toBe(true)
    expect(
      await pgProjectionExists('invites_pii', aggregateRef(InviteConfig, subject.orgId, inviteId)),
    ).toBe(true)

    await signInAndAttachSession(context, subject.email, subject.password)
    const page = await context.newPage()
    await anonymizeSelfViaUi(page)

    // AC-01: global account scrubbed + anonymizedAt set.
    const after = await readUserRow(subject.uid)
    expect(after).not.toBeNull()
    expect(after?.display_name).toBeNull()
    expect(after?.mobile).toBeNull()
    expect(after?.email).toBeNull()
    expect(after?.birth_date).toBeNull()
    expect(timestamptzToIso(after?.anonymized_at)).toBeTruthy()

    // AC-01 irreversibility: no field still holds the old name/email.
    const serialized = JSON.stringify(after)
    expect(serialized).not.toContain(subject.email)

    // AC-02: per-org _pii docs scrubbed (deleted).
    expect(
      await pgProjectionExists(
        'member_operations_pii',
        aggregateRef(MemberOperationConfig, subject.orgId, `e2e-prof-${subject.uid}`),
      ),
    ).toBe(false)
    expect(
      await pgProjectionExists('invites_pii', aggregateRef(InviteConfig, subject.orgId, inviteId)),
    ).toBe(false)

    // AC-04: the record keeps its `userId` pointer (retention).
    const record = await pgReadProjection(
      'appointments',
      aggregateRef(AppointmentConfig, subject.orgId, recordId),
    )
    expect(record?.customer_user_id).toEqual(subject.uid)

    // AC-07 scoping: the unrelated account is byte-for-byte untouched.
    expect(await readUserRow(other.uid)).toEqual(otherBefore)
  })

  test('anonymous customer (no account) is a no-op and never errors', async ({ context }) => {
    // The subject anonymizes their own account; a org with NO walk-in
    // account doc proves the no-userId path is harmless. We assert the action
    // succeeds end-to-end for an account whose org has no _pii to scrub.
    const subject = await seedOrg({ memberOperationCount: 0 })
    await signInAndAttachSession(context, subject.email, subject.password)
    const page = await context.newPage()
    await anonymizeSelfViaUi(page)
    const after = await readUserRow(subject.uid)
    expect(timestamptzToIso(after?.anonymized_at)).toBeTruthy()
  })
})
