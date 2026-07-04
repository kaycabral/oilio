import { expect, test } from '../fixtures'
import { pgQueryProjection, seedOrg, signInAndAttachSession } from '../helpers/session'

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

// Returns the `pii_events` rows for a single subject. Post-cutover the audit
// sink is the Postgres `pii_events` table (brief 0062); we filter by
// `subject_ref` so the result is scoped to this run's subject. Columns are
// snake_case (`subject_ref`, `fields_changed`) — the asserts read them directly.
async function listPiiEvents(subjectRef: string): Promise<Array<Record<string, unknown>>> {
  return pgQueryProjection('pii_events', 'subject_ref', subjectRef)
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
    const owner = await seedOrg({ memberOperationCount: 0 })
    await signInAndAttachSession(context, owner.email, owner.password)
    const page = await context.newPage()

    // Scope name assertions to the page content (`<main>`): the member's own name
    // now also renders in the sidebar footer (brief 0090 UserMenu), so an
    // unscoped getByText would match twice.
    const main = page.getByRole('main')
    // Baseline: the seeded owner shows as "E2E Owner" on the team screen.
    await page.goto('/team')
    await expect(main.getByText('E2E Owner', { exact: true })).toBeVisible()

    // Rectify the name on the self-service profile surface (AC-06).
    const newName = `Renomeado ${Date.now()}`
    await page.goto('/settings/profile')
    await expect(page.getByRole('heading', { name: 'Meu perfil' })).toBeVisible()
    await page.getByRole('textbox', { name: 'Nome' }).fill(newName)
    await page.getByRole('button', { name: 'Salvar alterações' }).click()
    await expect(page.getByText('Perfil atualizado.')).toBeVisible()

    // One write reflects live — the new name shows on /team (identity by ref).
    await page.goto('/team')
    await expect(main.getByText(newName, { exact: true })).toBeVisible()
    await expect(main.getByText('E2E Owner', { exact: true })).toHaveCount(0)

    // The global users/{uid} carries the new name (single source of truth).
    const userRows = await pgQueryProjection('users', 'uid', owner.uid)
    expect(userRows[0]?.display_name).toEqual(newName)

    // AC-07: a pii_rectified event was emitted — opaque subject_ref + field
    // NAMES only, NO values (the new name must not appear anywhere).
    const events = await listPiiEvents(owner.uid)
    const rectified = events.filter((e) => e.event === 'pii_rectified')
    expect(rectified.length).toBeGreaterThan(0)
    const last = rectified.at(-1)
    expect(last?.subject_ref).toEqual(owner.uid)
    expect(last?.scope).toEqual('account')
    expect(last?.fields_changed).toContain('displayName')
    assertNoPiiInEvents(rectified, [newName, owner.email])
  })

  test('erasure emits PII-free pii_erasure_requested + pii_anonymized', async ({ context }) => {
    const owner = await seedOrg({ memberOperationCount: 0 })
    const originalEmail = owner.email
    await signInAndAttachSession(context, owner.email, owner.password)
    const page = await context.newPage()

    await page.goto('/settings/privacy')
    await expect(page.getByRole('heading', { name: 'Excluir minha conta inteira' })).toBeVisible()
    await page.getByRole('textbox').fill('EXCLUIR')
    await page.getByRole('button', { name: 'Excluir meus dados', exact: true }).click()
    await page.waitForURL('**/login', { timeout: 15_000 })

    const events = await listPiiEvents(owner.uid)
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
