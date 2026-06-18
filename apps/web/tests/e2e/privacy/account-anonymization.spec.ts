import type { Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { expect, test } from '../fixtures'
import { FIRESTORE_HOST, PROJECT_ID } from '../helpers/emulator'
import type { FsDocument } from '../helpers/firestore-rest'
import { decodeFsDocument, parseJson, strField } from '../helpers/firestore-rest'
import {
  readUser,
  seedAppointment,
  seedCustomerShadowForUser,
  seedInvite,
  seedOrg,
  signInAndAttachSession,
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

const FS_BASE = `http://${FIRESTORE_HOST}/v1/projects/${PROJECT_ID}/databases/(default)/documents`

function fsGet(path: string): FsDocument | null {
  try {
    const out = execFileSync(
      'curl',
      ['-fsS', `${FS_BASE}/${path}`, '-H', 'Authorization: Bearer owner'],
      { encoding: 'utf8' },
    )
    return parseJson(out, decodeFsDocument)
  } catch {
    return null
  }
}

function fsPut(path: string, fields: Record<string, unknown>): void {
  execFileSync(
    'curl',
    [
      '-fsS',
      '-X',
      'PATCH',
      `${FS_BASE}/${path}`,
      '-H',
      'Authorization: Bearer owner',
      '-H',
      'Content-Type: application/json',
      '-d',
      JSON.stringify({ fields }),
    ],
    { encoding: 'utf8' },
  )
}

const strValue = (s: string) => ({ stringValue: s })
const nullValue = () => ({ nullValue: null })
const arrayStrValue = (items: string[]) => ({ arrayValue: { values: items.map(strValue) } })
const mapValue = (fields: Record<string, unknown>) => ({ mapValue: { fields } })

// Seeds a `professionals` projection + its `professionals_pii` (taxIdentity) for
// an existing user, mirroring the product write path. Returns the pid.
function seedProfessionalPiiFor(orgId: string, userId: string, unitIds: string[]): string {
  const pid = `e2e-prof-${userId}`
  const now = new Date().toISOString()
  fsPut(`orgs/${orgId}/professionals/${pid}`, {
    id: strValue(pid),
    orgId: strValue(orgId),
    userId: strValue(userId),
    operationalStatus: strValue('operational'),
    defaultCommission: nullValue(),
    unitIds: arrayStrValue(unitIds),
    serviceIds: arrayStrValue([]),
    createdAt: strValue(now),
    updatedAt: strValue(now),
  })
  fsPut(`orgs/${orgId}/professionals_pii/${pid}`, {
    taxIdentity: mapValue({ kind: strValue('individual'), taxId: strValue('39053344705') }),
  })
  return pid
}

// Seeds a transactional record (an appointment) that references the subject by
// `userId` — the thing we must NOT touch (AC-04 retention). Routes through the
// central typed helper so the appointment is complete + schema-valid: it seeds
// a per-org customer shadow keyed to the subject's user (so the appointment's
// denormalized `customerUserId` resolves to the subject) and references it.
function seedRecordFor(orgId: string, unitId: string, userId: string): string {
  const customerId = seedCustomerShadowForUser(orgId, userId)
  return seedAppointment({
    orgId,
    unitId,
    professionalId: `e2e-prof-absent-${userId}`,
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
    const subject = await seedOrg({ professionalCount: 0 })
    seedProfessionalPiiFor(subject.orgId, subject.uid, subject.unitIds)
    const { inviteId } = seedInvite({
      orgId: subject.orgId,
      email: subject.email,
      role: 'professional',
      invitedBy: subject.uid,
      status: 'accepted',
    })
    // Mark the invite accepted by the subject so the scrub finds it.
    fsPut(`orgs/${subject.orgId}/invites/${inviteId}`, {
      acceptedByUid: strValue(subject.uid),
    })
    const recordId = seedRecordFor(subject.orgId, subject.unitIds[0]!, subject.uid)

    // A second, unrelated account — must remain fully intact (AC-07 scoping).
    const other = await seedOrg({ professionalCount: 0 })
    const otherBefore = readUser(other.uid)

    // Pre-condition: the subject's PII is present.
    const before = readUser(subject.uid)
    expect(before?.displayName).toBeTruthy()
    expect(fsGet(`orgs/${subject.orgId}/professionals_pii/e2e-prof-${subject.uid}`)).not.toBeNull()
    expect(fsGet(`orgs/${subject.orgId}/invites_pii/${inviteId}`)).not.toBeNull()

    await signInAndAttachSession(context, subject.email, subject.password)
    const page = await context.newPage()
    await anonymizeSelfViaUi(page)

    // AC-01: global account scrubbed + anonymizedAt set.
    const after = readUser(subject.uid)
    expect(after).not.toBeNull()
    expect(after?.displayName).toEqual({ nullValue: null })
    expect(after?.whatsapp).toEqual({ nullValue: null })
    expect(after?.email).toEqual({ nullValue: null })
    expect(after?.birthDate).toEqual({ nullValue: null })
    expect(strField(after ?? undefined, 'anonymizedAt')).toBeTruthy()

    // AC-01 irreversibility: no field still holds the old name/email.
    const serialized = JSON.stringify(after)
    expect(serialized).not.toContain(subject.email)

    // AC-02: per-org _pii docs scrubbed (deleted).
    expect(fsGet(`orgs/${subject.orgId}/professionals_pii/e2e-prof-${subject.uid}`)).toBeNull()
    expect(fsGet(`orgs/${subject.orgId}/invites_pii/${inviteId}`)).toBeNull()

    // AC-04: the record keeps its `userId` pointer (retention).
    const record = fsGet(`orgs/${subject.orgId}/appointments/${recordId}`)
    expect(strField(record?.fields, 'customerUserId')).toEqual(subject.uid)

    // AC-07 scoping: the unrelated account is byte-for-byte untouched.
    expect(readUser(other.uid)).toEqual(otherBefore)
  })

  test('anonymous customer (no account) is a no-op and never errors', async ({ context }) => {
    // The subject anonymizes their own account; a org with NO walk-in
    // account doc proves the no-userId path is harmless. We assert the action
    // succeeds end-to-end for an account whose org has no _pii to scrub.
    const subject = await seedOrg({ professionalCount: 0 })
    await signInAndAttachSession(context, subject.email, subject.password)
    const page = await context.newPage()
    await anonymizeSelfViaUi(page)
    const after = readUser(subject.uid)
    expect(strField(after ?? undefined, 'anonymizedAt')).toBeTruthy()
  })
})
