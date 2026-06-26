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
  readCatalogItemByNameForAssert,
  readProductBase,
  seedProductBase,
  truncateProductBase,
} from '../helpers/session'

// Valid GTIN-13 (EAN-13) whose normalized GTIN-14 is the canonical key. Reused
// from the @cbrl/product integration fixtures so the validator agrees.
const KNOWN_EAN13 = '7891000100103'
const KNOWN_GTIN14 = '07891000100103'
const UNSEEN_EAN13 = '0036000291452'
const UNSEEN_GTIN14 = '00036000291452'

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

// Submit the new-item form and wait for the redirect to the catalog list. Wait
// for the button to be enabled first — the form's validity is client state
// (`useFormValidity`), so the button starts disabled and only enables once every
// required field has settled; clicking before then is a no-op. Then click and
// await the navigation.
async function submitNewItem(authedPage: Page): Promise<void> {
  const criar = authedPage.getByRole('button', { name: 'Criar' })
  await expect(criar).toBeEnabled()
  await criar.click()
  await expect(authedPage).toHaveURL(/\/catalog$/)
}

// BOTH the code boca (C, #1166) AND the name boca (D, #1171) read the SAME
// cross-org sovereign base and truncate it between tests. They MUST live in one
// serial describe (Playwright's `serial` is per-file): a second spec file
// touching this global table would run on another worker under fullyParallel and
// its truncate would wipe a row this one just seeded mid-assert (flaky). So the
// whole sovereign-base E2E surface is one serial unit here.
test.describe('Base de Produtos C+D — autofill por código e nome (DoD #1166/#1171)', () => {
  // Serial — these specs share ONE cross-org product base (no orgId to isolate
  // on), and the beforeEach truncates it. Under the suite's fullyParallel +
  // workers:2, a parallel run would let one worker's truncate wipe a row another
  // worker just seeded mid-assert (flaky). `serial` pins them to a single worker,
  // sequentially — the only safe model for a globally-shared, truncated table.
  test.describe.configure({ mode: 'serial' })

  test.use({
    orgInput: { unitCount: 1, professionalCount: 1, hasBusinessHours: true, slotMinutes: 30 },
  })

  test.beforeEach(async () => {
    if (hasBase) await truncateProductBase()
  })

  test('Cenário 4: sem código — fluxo manual intacto (self-contained)', async ({
    org,
    authedPage,
  }) => {
    // No DATABASE_URL needed: this is the no-code path, base never consulted.
    await startNewProduct(authedPage)

    // Register a product WITHOUT touching the code field. Fill price/stock/unit
    // first; type the name LAST and press Escape so any debounced suggestion list
    // (the name field is a combobox now) is dismissed before we submit — the
    // dropdown must not intercept the Criar click.
    await authedPage.locator('input[name="priceCents"]').fill('8,00')
    await authedPage.locator('input[name="stock"]').fill('3')
    await authedPage.locator('input[name="unitIds"]').first().check()
    // The product Nome is a combobox (uncontrolled input wired to a debounced
    // suggestion search). Type into it and ASSERT the value landed before
    // submitting, then Escape to dismiss any suggestion list — a bare `.fill()`
    // can race the combobox's onChange so the submitted value comes back empty.
    const nameInput = authedPage.locator('input[name="name"]')
    await nameInput.click()
    await nameInput.fill('Manufaturado Próprio')
    await expect(nameInput).toHaveValue('Manufaturado Próprio')
    await nameInput.press('Escape')

    await submitNewItem(authedPage)

    // Self-contained: no base reference (gtin14 null), editable as before.
    expect(await catalogItemGtin14(org.orgId, 'Manufaturado Próprio')).toBeNull()
  })

  // Base-backed scenarios — registered only with a real sovereign base.
  if (hasBase) {
    test('Cenário 1: hit — código conhecido preenche e trava o intrínseco', async ({
      org,
      authedPage,
    }) => {
      await seedProductBase({ gtin14: KNOWN_GTIN14, name: 'Leite Ninho 400g', source: 'official' })

      await startNewProduct(authedPage)

      // The user passes the reader (HID types + Enter) — autosubmit the lookup.
      const code = authedPage.getByLabel('Código do produto')
      await code.fill(KNOWN_EAN13)
      await code.press('Enter')

      // Hit: the name filled from the base and is read-only (a reference, AC-02).
      const name = authedPage.locator('input[name="name"]')
      await expect(name).toHaveValue('Leite Ninho 400g')
      await expect(name).toHaveAttribute('readonly', '')
      await expect(authedPage.getByText(/veio preenchido da base/i)).toBeVisible()

      // User only completes price/stock, then saves.
      await authedPage.locator('input[name="priceCents"]').fill('12,90')
      await authedPage.locator('input[name="stock"]').fill('7')
      await authedPage.locator('input[name="unitIds"]').first().check()
      await submitNewItem(authedPage)

      // The item is linked to the base by the canonical GTIN-14 (reference).
      expect(await catalogItemGtin14(org.orgId, 'Leite Ninho 400g')).toBe(KNOWN_GTIN14)
    })

    test('Cenário 2: miss — código novo contribui com o mínimo (GTIN + nome)', async ({
      org,
      authedPage,
    }) => {
      await startNewProduct(authedPage)

      const code = authedPage.getByLabel('Código do produto')
      await code.fill(UNSEEN_EAN13)
      await code.press('Enter')

      // Miss: name editable and is the required contribution (AC-03).
      const name = authedPage.locator('input[name="name"]')
      await expect(name).not.toHaveAttribute('readonly', '')
      await expect(authedPage.getByText(/dê um nome a este produto/i)).toBeVisible()
      await name.fill('Biscoito Recheado 140g')

      await authedPage.locator('input[name="priceCents"]').fill('3,50')
      await authedPage.locator('input[name="stock"]').fill('20')
      await authedPage.locator('input[name="unitIds"]').first().check()
      await submitNewItem(authedPage)

      // The base received an org-contributed Product with the minimum (GTIN + name).
      const contributed = await readProductBase(UNSEEN_GTIN14)
      expect(contributed?.name).toBe('Biscoito Recheado 140g')
      expect(contributed?.source).toBe('org-contributed')

      // The item references it, and a 2nd registration of the same code now HITS.
      expect(await catalogItemGtin14(org.orgId, 'Biscoito Recheado 140g')).toBe(UNSEEN_GTIN14)

      await startNewProduct(authedPage)
      const code2 = authedPage.getByLabel('Código do produto')
      await code2.fill(UNSEEN_EAN13)
      await code2.press('Enter')
      const name2 = authedPage.locator('input[name="name"]')
      await expect(name2).toHaveValue('Biscoito Recheado 140g')
      await expect(name2).toHaveAttribute('readonly', '')
    })

    // ── Feature D — autocomplete por nome (DoD #1171) ────────────────────────

    test('D · Cenário 1: busca por nome → escolher → referencia (read-only, gtin14)', async ({
      org,
      authedPage,
    }) => {
      await seedProductBase({ gtin14: KNOWN_GTIN14, name: 'Leite Ninho 400g', source: 'official' })

      await startNewProduct(authedPage)
      await searchAndChoose(authedPage, 'ninho', 'Leite Ninho')

      // Chosen: the name filled from the base and is read-only (a reference, AC-02).
      const name = authedPage.locator('input[name="name"]')
      await expect(name).toHaveValue('Leite Ninho 400g')
      await expect(name).toHaveAttribute('readonly', '')

      await authedPage.locator('input[name="priceCents"]').fill('12,90')
      await authedPage.locator('input[name="stock"]').fill('7')
      await authedPage.locator('input[name="unitIds"]').first().check()
      await submitNewItem(authedPage)

      // Linked to the base by the canonical GTIN-14 (reference, AC-02).
      expect(await catalogItemGtin14(org.orgId, 'Leite Ninho 400g')).toBe(KNOWN_GTIN14)
    })

    test('D · Cenário 2: similaridade tolera erro de digitação (typo ainda acha)', async ({
      authedPage,
    }) => {
      await seedProductBase({ gtin14: KNOWN_GTIN14, name: 'Leite Ninho 400g', source: 'official' })

      await startNewProduct(authedPage)
      // "leit ninho" — a typo (missing 'e'); pg_trgm still surfaces the product.
      await searchAndChoose(authedPage, 'leit ninho', 'Leite Ninho')

      const name = authedPage.locator('input[name="name"]')
      await expect(name).toHaveValue('Leite Ninho 400g')
      await expect(name).toHaveAttribute('readonly', '')
    })

    test('D · Cenário 3: zero resultado — cadastro nunca trava (best-effort)', async ({
      org,
      authedPage,
    }) => {
      await seedProductBase({ gtin14: KNOWN_GTIN14, name: 'Leite Ninho 400g', source: 'official' })

      await startNewProduct(authedPage)
      const name = authedPage.locator('input[name="name"]')
      await name.click()
      await name.fill('Parafuso Sextavado Inox')

      // No suggestions surface (zero match) — the field stays an ordinary name
      // input: editable, no readonly, no blocking error. The cadastro completes.
      await expect(authedPage.getByRole('listbox')).toHaveCount(0)
      await expect(name).not.toHaveAttribute('readonly', '')

      await authedPage.locator('input[name="priceCents"]').fill('5,00')
      await authedPage.locator('input[name="stock"]').fill('10')
      await authedPage.locator('input[name="unitIds"]').first().check()
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
