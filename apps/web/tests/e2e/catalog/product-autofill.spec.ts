// Feature-level E2E — brief 0054 § Definition of Done (parent #1166): the first
// REAL end-to-end of the sovereign product base. The autofill reads @cbrl/product
// (Postgres) live from the product-registration form, so this suite runs WITH a
// real base behind it (scripts/e2e-with-postgres.mjs locally / CI services:
// postgres; globalSetup applies the migrations). 1 test per DoD scenario:
//   1. Hit  — a known code fills the intrinsics read-only; user completes price.
//   2. Miss — a valid unknown code contributes the minimum (GTIN + name); a 2nd
//             registration of the same code then hits.
//   3. Base off — Postgres unreachable never blocks the cadastro (best-effort).
//   4. No code — the manual flow is untouched (item self-contained).
//
// The code field NEVER speaks GTIN/SKU/barcode to the user (AC-04); the spec
// drives it via its human label "Código do produto".

import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures'
import {
  deleteProductBaseForWorker,
  readCatalogItemByNameForAssert,
  readProductBase,
  seedProductBase,
} from '../helpers/session'
import { sovereignBaseNamespace } from '../helpers/sovereign-base'

// The hit/miss scenarios need a real base (DATABASE_URL). The canonical e2e
// runner (scripts/e2e-with-postgres.mjs / CI services: postgres) always provides
// one; a bare `playwright test` (test:e2e:no-base) does not. The base-backed
// tests register only when the base is present, and we shout otherwise so a run
// without it can't masquerade as full green (no silent cap).
const hasBase = Boolean(process.env.DATABASE_URL)
if (!hasBase) {
  console.warn(
    '[product-autofill.spec] DATABASE_URL unset — hit/miss scenarios not registered (run via pnpm --filter @oilio/web test:e2e for the full DoD).',
  )
}

// Read a catalog item's `gtin14` back for assertions, backend-aware (the typed
// Postgres row under the flag, else the Firestore emulator) — the autofill writes
// the reference through the active backend, so the assertion must read it there.
async function catalogItemGtin14(orgId: string, name: string): Promise<string | null> {
  const item = await readCatalogItemByNameForAssert(orgId, name)
  return item?.gtin14 ?? null
}

async function startNewProduct(authedPage: Page): Promise<void> {
  await authedPage.goto('/catalog/new')
  const product = authedPage
    .getByRole('radiogroup', { name: 'Tipo do item' })
    .getByRole('radio', { name: 'Produto' })
  // The kind toggle + the form's required-field validity are client state — they
  // only respond once the form has hydrated. A single click can land before React
  // attaches its handler (the first test of a serial run is the worst case), so
  // retry the click until the selection actually takes (the product-only `stock`
  // field appears). Re-clicking is safe: selecting "Produto" is idempotent (it
  // sets the kind to product, never toggles). No fixed sleep — web-first retry.
  await expect(async () => {
    await product.click()
    await expect(authedPage.locator('input[name="stock"]')).toBeVisible({ timeout: 1000 })
  }).toPass()
}

// Type into the Nome combobox (feature D) and choose the first matching suggestion.
// The debounce (~250ms) + the live base query resolve into the listbox; we wait
// for the option (web-first, no fixed sleep), then click it.
async function searchAndChoose(authedPage: Page, term: string, optionName: string): Promise<void> {
  const name = authedPage.locator('input[name="name"]')
  await name.click()
  await name.fill(term)
  await authedPage.getByRole('option', { name: new RegExp(optionName, 'i') }).click()
}

// Set the product Nome (a combobox: uncontrolled input wired to a debounced
// suggestion search). A bare `.fill()` can race the combobox's onChange so the
// submitted value comes back empty — and an empty name leaves the form invalid,
// so the "Criar" button stays disabled, the click is a no-op, and the redirect
// never fires (the failure that flaked `submitNewItem` under CI load). Type, then
// ASSERT the value landed before continuing, then Escape to dismiss any
// suggestion list so it can't intercept the later submit click. Use this whenever
// a test FILLS the name and then submits (the search-and-choose path uses
// `searchAndChoose`, which lands the value via the chosen option instead).
async function fillProductName(authedPage: Page, value: string): Promise<void> {
  const nameInput = authedPage.locator('input[name="name"]')
  await nameInput.click()
  await nameInput.fill(value)
  await expect(nameInput).toHaveValue(value)
  // Escape now also ABORTS the pending debounced search (ProductNameCombobox →
  // onDismiss → cancelSearch), so no late re-render fires after this point. Anchor
  // on the POSITIVE settled state the official PW guidance recommends over a bare
  // sleep/negative check: the "Buscando…" hint is gone and the listbox is closed.
  // Once both hold, the form is quiescent and the later submit can't race a
  // search-driven re-render.
  await nameInput.press('Escape')
  await expect(authedPage.getByText('Buscando…')).toBeHidden()
  await expect(authedPage.getByRole('listbox')).toBeHidden()
}

// Submit the new-item form and wait for the redirect to the catalog list. Both
// steps are auto-retrying / auto-waiting (Playwright best practice — no hard
// timeouts): `toBeEnabled` waits out the form's client-side validity (the button
// is disabled until every required field, INCLUDING the debounced combobox name,
// has settled — clicking early is a silent no-op), and `waitForURL` blocks on the
// client-side `router.push('/catalog')` the form fires on success
// (`CatalogItemForm.tsx`). The earlier flake was NOT a slow redirect — it was a
// raced combobox leaving the name empty, so the button never enabled. That root
// cause is fixed at the fill site (`fillProductName`); these waits inherit the
// per-test timeout, no custom values needed.
async function submitNewItem(authedPage: Page): Promise<void> {
  const criar = authedPage.getByRole('button', { name: 'Criar' })
  await expect(criar).toBeEnabled()
  await criar.click()
  await authedPage.waitForURL(/\/catalog$/)
}

// BOTH the code boca (C, #1166) AND the name boca (D, #1171) read the SAME
// cross-org sovereign base (no orgId to isolate on). They isolate by KEY instead:
// each worker derives a unique, GS1-valid GTIN + worker-tagged name namespace from
// its `parallelIndex` (see `helpers/sovereign-base.ts`), seeds only its own rows,
// and cleans up only its own GTINs. So these specs run FULLY PARALLEL safely — no
// `serial`, no shared constants, no global truncate (the old model needed all
// three and flaked under CI's multi-worker e2e shards).
test.describe('Base de Produtos C+D — autofill por código e nome (DoD #1166/#1171)', () => {
  test.use({
    orgInput: { unitCount: 1, memberOperationCount: 1, hasBusinessHours: true, slotMinutes: 30 },
  })

  // Clear only THIS worker's rows so a parallel worker's namespace is untouched.
  test.beforeEach(async ({}, testInfo) => {
    if (hasBase) {
      const ns = sovereignBaseNamespace(testInfo.parallelIndex)
      await deleteProductBaseForWorker(ns.ownedGtins)
    }
  })

  test('Cenário 4: sem código — fluxo manual intacto (self-contained)', async ({
    org,
    authedPage,
  }) => {
    // No DATABASE_URL needed: this is the no-code path, base never consulted.
    await startNewProduct(authedPage)

    // Register a product WITHOUT touching the code field. Fill price/stock/unit
    // first; type the name LAST via the combobox-safe helper (asserts the value
    // landed + dismisses any suggestion list) so the dropdown can't intercept the
    // Criar click and the submitted name is never empty.
    await authedPage.locator('input[name="priceCents"]').fill('8,00')
    await authedPage.locator('input[name="stock"]').fill('3')
    await authedPage.locator('input[name="unitIds"]').first().check()
    await fillProductName(authedPage, 'Manufaturado Próprio')

    await submitNewItem(authedPage)

    // Self-contained: no base reference (gtin14 null), editable as before.
    expect(await catalogItemGtin14(org.orgId, 'Manufaturado Próprio')).toBeNull()
  })

  // Base-backed scenarios — registered only with a real sovereign base.
  if (hasBase) {
    test('Cenário 1: hit — código conhecido preenche e trava o intrínseco', async ({
      org,
      authedPage,
    }, testInfo) => {
      const ns = sovereignBaseNamespace(testInfo.parallelIndex)
      await seedProductBase({ gtin14: ns.knownGtin14, name: ns.knownName, source: 'official' })

      await startNewProduct(authedPage)

      // The user passes the reader (HID types + Enter) — autosubmit the lookup.
      const code = authedPage.getByLabel('Código do produto')
      await code.fill(ns.knownEan13)
      await code.press('Enter')

      // Hit: the name filled from the base and is read-only (a reference, AC-02).
      const name = authedPage.locator('input[name="name"]')
      await expect(name).toHaveValue(ns.knownName)
      await expect(name).toHaveAttribute('readonly', '')
      await expect(authedPage.getByText(/veio preenchido da base/i)).toBeVisible()

      // User only completes price/stock, then saves.
      await authedPage.locator('input[name="priceCents"]').fill('12,90')
      await authedPage.locator('input[name="stock"]').fill('7')
      await authedPage.locator('input[name="unitIds"]').first().check()
      await submitNewItem(authedPage)

      // The item is linked to the base by the canonical GTIN-14 (reference).
      expect(await catalogItemGtin14(org.orgId, ns.knownName)).toBe(ns.knownGtin14)
    })

    test('Cenário 2: miss — código novo contribui com o mínimo (GTIN + nome)', async ({
      org,
      authedPage,
    }, testInfo) => {
      const ns = sovereignBaseNamespace(testInfo.parallelIndex)
      await startNewProduct(authedPage)

      const code = authedPage.getByLabel('Código do produto')
      await code.fill(ns.unseenEan13)
      await code.press('Enter')

      // Miss: name editable and is the required contribution (AC-03).
      const name = authedPage.locator('input[name="name"]')
      await expect(name).not.toHaveAttribute('readonly', '')
      await expect(authedPage.getByText(/dê um nome a este produto/i)).toBeVisible()

      // Required fields FIRST, name (combobox) LAST — its debounced search
      // re-renders the form after the fill and would clobber any sibling input
      // typed in between (see Cenário 3).
      await authedPage.locator('input[name="priceCents"]').fill('3,50')
      await authedPage.locator('input[name="stock"]').fill('20')
      await authedPage.locator('input[name="unitIds"]').first().check()

      // Combobox-safe fill: a bare `.fill()` here raced the debounced onChange, so
      // the name didn't land, the form stayed invalid, and "Criar" never enabled.
      await fillProductName(authedPage, ns.contributedName)
      await submitNewItem(authedPage)

      // The base received an org-contributed Product with the minimum (GTIN + name).
      const contributed = await readProductBase(ns.unseenGtin14)
      expect(contributed?.name).toBe(ns.contributedName)
      expect(contributed?.source).toBe('org-contributed')

      // The item references it, and a 2nd registration of the same code now HITS.
      expect(await catalogItemGtin14(org.orgId, ns.contributedName)).toBe(ns.unseenGtin14)

      await startNewProduct(authedPage)
      const code2 = authedPage.getByLabel('Código do produto')
      await code2.fill(ns.unseenEan13)
      await code2.press('Enter')
      const name2 = authedPage.locator('input[name="name"]')
      await expect(name2).toHaveValue(ns.contributedName)
      await expect(name2).toHaveAttribute('readonly', '')
    })

    // ── Feature D — autocomplete por nome (DoD #1171) ────────────────────────

    test('D · Cenário 1: busca por nome → escolher → referencia (read-only, gtin14)', async ({
      org,
      authedPage,
    }, testInfo) => {
      const ns = sovereignBaseNamespace(testInfo.parallelIndex)
      await seedProductBase({ gtin14: ns.knownGtin14, name: ns.knownName, source: 'official' })

      await startNewProduct(authedPage)
      await searchAndChoose(authedPage, ns.knownSearchTerm, ns.knownName)

      // Chosen: the name filled from the base and is read-only (a reference, AC-02).
      const name = authedPage.locator('input[name="name"]')
      await expect(name).toHaveValue(ns.knownName)
      await expect(name).toHaveAttribute('readonly', '')

      await authedPage.locator('input[name="priceCents"]').fill('12,90')
      await authedPage.locator('input[name="stock"]').fill('7')
      await authedPage.locator('input[name="unitIds"]').first().check()
      await submitNewItem(authedPage)

      // Linked to the base by the canonical GTIN-14 (reference, AC-02).
      expect(await catalogItemGtin14(org.orgId, ns.knownName)).toBe(ns.knownGtin14)
    })

    test('D · Cenário 2: similaridade tolera erro de digitação (typo ainda acha)', async ({
      authedPage,
    }, testInfo) => {
      const ns = sovereignBaseNamespace(testInfo.parallelIndex)
      await seedProductBase({ gtin14: ns.knownGtin14, name: ns.knownName, source: 'official' })

      await startNewProduct(authedPage)
      // A typo (missing 'e' in "leite"); pg_trgm still surfaces the product.
      await searchAndChoose(authedPage, ns.knownSearchTypo, ns.knownName)

      const name = authedPage.locator('input[name="name"]')
      await expect(name).toHaveValue(ns.knownName)
      await expect(name).toHaveAttribute('readonly', '')
    })

    test('D · Cenário 3: zero resultado — cadastro nunca trava (best-effort)', async ({
      org,
      authedPage,
    }, testInfo) => {
      const ns = sovereignBaseNamespace(testInfo.parallelIndex)
      await seedProductBase({ gtin14: ns.knownGtin14, name: ns.knownName, source: 'official' })

      await startNewProduct(authedPage)
      const name = authedPage.locator('input[name="name"]')

      // Fill the OTHER required fields FIRST, name LAST (same order as scenarios
      // 1/2/4). Fill required fields first, name last — a habit that costs nothing
      // and keeps field order uniform across scenarios. (The debounced search is
      // now aborted on the name field's Escape — see fillProductName — so a late
      // re-render no longer clobbers siblings, but name-last stays the convention.)
      await authedPage.locator('input[name="priceCents"]').fill('5,00')
      await authedPage.locator('input[name="stock"]').fill('10')
      await authedPage.locator('input[name="unitIds"]').first().check()

      await fillProductName(authedPage, 'Parafuso Sextavado Inox')

      // Zero match → the field stays an ordinary, editable name input (no
      // suggestion lock). `fillProductName` already asserted the listbox is hidden;
      // assert the positive state that proves no base hit locked the field.
      await expect(name).toBeEditable()

      await submitNewItem(authedPage)

      // Registered manually, self-contained (no base reference).
      expect(await catalogItemGtin14(org.orgId, 'Parafuso Sextavado Inox')).toBeNull()
    })
  }
})

// Scenario 3 — base OFF (Postgres unreachable, not just zero-match) — is owned by
// the best-effort integration suites, which prove degradation on a real outage
// WITHOUT failing the registration (the load-bearing invariant): the code gate by
// product-gate-besteffort.pg.integration.test.ts (C, reconciliation marker) and
// the name search by product-name-search-besteffort.pg.integration.test.ts (D,
// empty result). An E2E that kills Postgres mid-suite would be flaky and slow; the
// integration tests own that invariant deterministically. Kept out of this file on
// purpose (no silent gap): the DoD trace points there. The zero-MATCH path (base
// up, no similar row) IS covered here (D · Cenário 3).
