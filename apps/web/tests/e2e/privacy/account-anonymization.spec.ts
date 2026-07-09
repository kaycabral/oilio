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

async function readUserRow(uid: string): Promise<Record<string, unknown> | null> {
  const rows = await pgQueryProjection('users', 'uid', uid)
  return rows[0] ?? null
}

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

async function anonymizeSelfViaUi(page: Page): Promise<void> {
  await page.goto('/settings/privacy')
  await expect(page.getByRole('heading', { name: 'Excluir minha conta inteira' })).toBeVisible()
  await page.getByRole('textbox').fill('EXCLUIR')
  await page.getByRole('button', { name: 'Excluir meus dados', exact: true }).click()
  await page.waitForURL('**/login', { timeout: 15_000 })
}

test.describe('account-level PII anonymization', () => {
  test('self-service erasure scrubs the global account + _pii; records keep userId; other accounts untouched', async ({
    context,
  }) => {
    const subject = await seedOrg({ memberOperationCount: 0 })
    await seedMemberOperationPiiFor(subject.orgId, subject.uid, subject.unitIds)
    const { inviteId } = await seedInvite({
      orgId: subject.orgId,
      mobile: '5511990003456',
      role: 'member_operator',
      invitedBy: subject.uid,
      status: 'accepted',
    })
    await setInviteAcceptedBy(subject.orgId, inviteId, subject.uid)
    const recordId = await seedRecordFor(subject.orgId, subject.unitIds[0]!, subject.uid)

    const other = await seedOrg({ memberOperationCount: 0 })
    const otherBefore = await readUserRow(other.uid)

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

    const after = await readUserRow(subject.uid)
    expect(after).not.toBeNull()
    expect(after?.display_name).toBeNull()
    expect(after?.mobile).toBeNull()
    expect(after?.email).toBeNull()
    expect(after?.birth_date).toBeNull()
    expect(timestamptzToIso(after?.anonymized_at)).toBeTruthy()

    const serialized = JSON.stringify(after)
    expect(serialized).not.toContain(subject.email)

    expect(
      await pgProjectionExists(
        'member_operations_pii',
        aggregateRef(MemberOperationConfig, subject.orgId, `e2e-prof-${subject.uid}`),
      ),
    ).toBe(false)
    expect(
      await pgProjectionExists('invites_pii', aggregateRef(InviteConfig, subject.orgId, inviteId)),
    ).toBe(false)

    const record = await pgReadProjection(
      'appointments',
      aggregateRef(AppointmentConfig, subject.orgId, recordId),
    )
    expect(record?.customer_user_id).toEqual(subject.uid)

    expect(await readUserRow(other.uid)).toEqual(otherBefore)
  })

  test('anonymous customer (no account) is a no-op and never errors', async ({ context }) => {
    const subject = await seedOrg({ memberOperationCount: 0 })
    await signInAndAttachSession(context, subject.email, subject.password)
    const page = await context.newPage()
    await anonymizeSelfViaUi(page)
    const after = await readUserRow(subject.uid)
    expect(timestamptzToIso(after?.anonymized_at)).toBeTruthy()
  })
})
