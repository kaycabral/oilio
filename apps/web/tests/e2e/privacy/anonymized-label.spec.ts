import { anonymizedSubjectCode } from '@/domain'
import { execFileSync } from 'node:child_process'
import { expect, test } from '../fixtures'
import { FIRESTORE_HOST, PROJECT_ID } from '../helpers/emulator'
import { seedCustomer, seedMember, seedTenant, signInAndAttachSession } from '../helpers/session'

// Feature-level E2E — neutral label for anonymized accounts (brief 0032 / #1095).
//
// AC-03: wherever a name is resolved LIVE from the global `users/{uid}`, an
// anonymized account (`anonymizedAt` set) shows the neutral label
// `‹Role› ‹CODE›` (ex.: "Cliente 7K2A") instead of the scrubbed name — no
// "removido"/reason. Two anonymized subjects stay distinct (different codes);
// a NON-anonymized account keeps its real name.
//
// Surfaces covered (all inherit the shared resolver `resolveSubjectName`):
//   - customer list (`customer-read`)
//   - team list + member detail (`membership` / `/team/[userId]`)

const FS_BASE = `http://${FIRESTORE_HOST}/v1/projects/${PROJECT_ID}/databases/(default)/documents`

// Marks a global account as anonymized, mirroring the #1093 scrub: PII fields
// go null and `anonymizedAt` is stamped. The resolver keys off `anonymizedAt`.
function anonymizeUser(userId: string): void {
  const now = new Date().toISOString()
  execFileSync(
    'curl',
    [
      '-fsS',
      '-X',
      'PATCH',
      `${FS_BASE}/users/${userId}?updateMask.fieldPaths=displayName&updateMask.fieldPaths=whatsapp&updateMask.fieldPaths=email&updateMask.fieldPaths=birthDate&updateMask.fieldPaths=anonymizedAt&updateMask.fieldPaths=updatedAt`,
      '-H',
      'Authorization: Bearer owner',
      '-H',
      'Content-Type: application/json',
      '-d',
      JSON.stringify({
        fields: {
          displayName: { nullValue: null },
          whatsapp: { nullValue: null },
          email: { nullValue: null },
          birthDate: { nullValue: null },
          anonymizedAt: { stringValue: now },
          updatedAt: { stringValue: now },
        },
      }),
    ],
    { encoding: 'utf8' },
  )
}

test.describe('neutral label for anonymized accounts', () => {
  test('customer list: anonymized accounts show `Cliente ‹CODE›`, two stay distinct, a live account keeps its name', async ({
    context,
  }) => {
    const owner = await seedTenant({ professionalCount: 0 })

    const anonUserA = `e2e-cust-anon-a-${Date.now()}`
    const anonUserB = `e2e-cust-anon-b-${Date.now()}`
    const liveUser = `e2e-cust-live-${Date.now()}`
    seedCustomer(owner.tenantId, { name: 'Ana Anonimizada', userId: anonUserA })
    seedCustomer(owner.tenantId, { name: 'Bruno Anonimizado', userId: anonUserB })
    seedCustomer(owner.tenantId, { name: 'Carla Ativa', userId: liveUser })

    anonymizeUser(anonUserA)
    anonymizeUser(anonUserB)

    await signInAndAttachSession(context, owner.email, owner.password)
    const page = await context.newPage()
    await page.goto('/customers')

    const labelA = `Cliente ${anonymizedSubjectCode(anonUserA)}`
    const labelB = `Cliente ${anonymizedSubjectCode(anonUserB)}`

    // Both anonymized customers render the neutral label.
    await expect(page.getByText(labelA, { exact: true })).toBeVisible()
    await expect(page.getByText(labelB, { exact: true })).toBeVisible()
    // Distinct subjects → distinct codes (no collapse).
    expect(labelA).not.toEqual(labelB)
    // The scrubbed names never surface; no "removido"/reason text.
    await expect(page.getByText('Ana Anonimizada')).toHaveCount(0)
    await expect(page.getByText('Bruno Anonimizado')).toHaveCount(0)
    await expect(page.getByText(/removido/i)).toHaveCount(0)
    // The non-anonymized account keeps its real name.
    await expect(page.getByText('Carla Ativa', { exact: true })).toBeVisible()
  })

  test('team list + member detail: anonymized member shows `Profissional ‹CODE›`', async ({
    context,
  }) => {
    const owner = await seedTenant({ professionalCount: 0 })
    const { userId } = seedMember(owner.tenantId, {
      role: 'professional',
      displayName: 'Daniel Profissional',
    })
    anonymizeUser(userId)

    const label = `Profissional ${anonymizedSubjectCode(userId)}`

    await signInAndAttachSession(context, owner.email, owner.password)
    const page = await context.newPage()

    // Team list (member-name join via `listTenantMembers` / `/team`).
    await page.goto('/team')
    await expect(page.getByText(label, { exact: true }).first()).toBeVisible()
    await expect(page.getByText('Daniel Profissional')).toHaveCount(0)
    await expect(page.getByText(/removido/i)).toHaveCount(0)

    // Member detail `/team/[userId]` (0037) — heading shows the neutral label.
    await page.goto(`/team/${userId}`)
    await expect(page.getByRole('heading', { name: label })).toBeVisible()
    await expect(page.getByText('Daniel Profissional')).toHaveCount(0)
  })
})
