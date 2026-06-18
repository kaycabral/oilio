import { execFileSync } from 'node:child_process'
import { expect, test } from '../fixtures'
import { FIRESTORE_HOST, PROJECT_ID } from '../helpers/emulator'
import type { FsValue } from '../helpers/firestore-rest'
import { decodeFsQueryRows, parseJson, strField } from '../helpers/firestore-rest'
import { readUser, seedOrg, signInAndAttachSession } from '../helpers/session'

// Feature-level E2E — self-service rectification + PII-free pii_* events
// (brief 0032 / #1066).
//
//   AC-06 — the subject edits their own global `users/{uid}` profile and the
//           change reflects LIVE on every screen (identity by reference): the
//           new name shows up on /team without touching any record.
//   AC-07 — the privacy lifecycle emits `pii_rectified` / `pii_anonymized` /
//           `pii_erasure_requested` with NO PII in the payload (only opaque
//           refs + field NAMES) — the no-pii-in-events invariant for the
//           privacy domain.

const FS_BASE = `http://${FIRESTORE_HOST}/v1/projects/${PROJECT_ID}/databases/(default)/documents`

// Returns the decoded `pii_events/` records for a single subject. The
// collection is the ownership-preserving sink for privacy events until the
// track() layer (0026) lands. We query by `subject_ref` via `:runQuery` (not a
// bare collection GET) so the result is scoped to this run's subject and does
// NOT depend on collection size — a plain list GET is paginated (first ~30
// docs only), so on a shared/persisted emulator a fresh subject's events can
// fall outside the page and read as empty.
function listPiiEvents(subjectRef: string): Array<Record<string, unknown>> {
  let out: string
  try {
    out = execFileSync(
      'curl',
      [
        '-fsS',
        '-X',
        'POST',
        `${FS_BASE}:runQuery`,
        '-H',
        'Authorization: Bearer owner',
        '-H',
        'Content-Type: application/json',
        '-d',
        JSON.stringify({
          structuredQuery: {
            from: [{ collectionId: 'pii_events' }],
            where: {
              fieldFilter: {
                field: { fieldPath: 'subject_ref' },
                op: 'EQUAL',
                value: { stringValue: subjectRef },
              },
            },
          },
        }),
      ],
      { encoding: 'utf8' },
    )
  } catch {
    return []
  }
  const rows = parseJson(out, decodeFsQueryRows)
  return rows.filter((r) => r.document).map((r) => decodeFields(r.document?.fields ?? {}))
}

// Minimal decoder for the Firestore typed-value shape we emit (strings + a
// string array for `fields_changed`).
function decodeFields(fields: Record<string, FsValue>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, raw] of Object.entries(fields)) {
    if ('stringValue' in raw) out[key] = raw.stringValue
    else if ('nullValue' in raw) out[key] = null
    else if ('arrayValue' in raw) {
      const items = raw.arrayValue?.values ?? []
      out[key] = items.map((i) => i.stringValue)
    }
  }
  return out
}

// PII tokens that must NEVER appear in any privacy-event payload (AC-07).
function assertNoPiiInEvents(events: Array<Record<string, unknown>>, pii: string[]): void {
  const serialized = JSON.stringify(events)
  for (const value of pii) {
    if (value) expect(serialized).not.toContain(value)
  }
}

test.describe('self-service rectification + pii_* events', () => {
  test('editing own profile reflects live across screens and emits a PII-free pii_rectified', async ({
    context,
  }) => {
    const owner = await seedOrg({ professionalCount: 0 })
    await signInAndAttachSession(context, owner.email, owner.password)
    const page = await context.newPage()

    // Baseline: the seeded owner shows as "E2E Owner" on the team screen.
    await page.goto('/team')
    await expect(page.getByText('E2E Owner', { exact: true })).toBeVisible()

    // Rectify the name on the self-service profile surface (AC-06).
    const newName = `Renomeado ${Date.now()}`
    await page.goto('/settings/profile')
    await expect(page.getByRole('heading', { name: 'Meu perfil' })).toBeVisible()
    await page.getByRole('textbox', { name: 'Nome' }).fill(newName)
    await page.getByRole('button', { name: 'Salvar alterações' }).click()
    await expect(page.getByText('Perfil atualizado.')).toBeVisible()

    // One write reflects live — the new name shows on /team (identity by ref).
    await page.goto('/team')
    await expect(page.getByText(newName, { exact: true })).toBeVisible()
    await expect(page.getByText('E2E Owner', { exact: true })).toHaveCount(0)

    // The global users/{uid} carries the new name (single source of truth).
    const after = readUser(owner.uid)
    expect(strField(after ?? undefined, 'displayName')).toEqual(newName)

    // AC-07: a pii_rectified event was emitted — opaque subject_ref + field
    // NAMES only, NO values (the new name must not appear anywhere).
    const events = listPiiEvents(owner.uid)
    const rectified = events.filter((e) => e.event === 'pii_rectified')
    expect(rectified.length).toBeGreaterThan(0)
    const last = rectified.at(-1)
    expect(last?.subject_ref).toEqual(owner.uid)
    expect(last?.scope).toEqual('account')
    expect(last?.fields_changed).toContain('displayName')
    assertNoPiiInEvents(rectified, [newName, owner.email])
  })

  test('erasure emits PII-free pii_erasure_requested + pii_anonymized', async ({ context }) => {
    const owner = await seedOrg({ professionalCount: 0 })
    const originalEmail = owner.email
    await signInAndAttachSession(context, owner.email, owner.password)
    const page = await context.newPage()

    await page.goto('/settings/privacy')
    await expect(page.getByRole('heading', { name: 'Excluir minha conta inteira' })).toBeVisible()
    await page.getByRole('textbox').fill('EXCLUIR')
    await page.getByRole('button', { name: 'Excluir meus dados', exact: true }).click()
    await page.waitForURL('**/login', { timeout: 15_000 })

    const events = listPiiEvents(owner.uid)
    const requested = events.filter((e) => e.event === 'pii_erasure_requested')
    const anonymized = events.filter((e) => e.event === 'pii_anonymized')
    expect(requested.length).toBeGreaterThan(0)
    expect(anonymized.length).toBeGreaterThan(0)
    // subject_ref is opaque (the userId), scope is account.
    expect(requested.at(0)?.scope).toEqual('account')
    expect(anonymized.at(0)?.scope).toEqual('account')

    // AC-07: NO PII in any privacy event — neither the (now scrubbed) name nor
    // the email ever appears in a payload.
    assertNoPiiInEvents([...requested, ...anonymized], ['E2E Owner', originalEmail])
  })
})
