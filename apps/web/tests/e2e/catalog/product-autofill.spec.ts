import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures'
import {
  deleteProductBaseForWorker,
  readCatalogItemByNameForAssert,
  readProductBase,
  seedProductBase,
} from '../helpers/session'
import { sovereignBaseNamespace } from '../helpers/sovereign-base'

const hasBase = Boolean(process.env.DATABASE_URL)
if (!hasBase) {
  console.warn(
    '[product-autofill.spec] DATABASE_URL unset — hit/miss scenarios not registered (run via pnpm --filter @oilio/web test:e2e for the full DoD).',
  )
}

async function catalogItemGtin14(orgId: string, name: string): Promise<string | null> {
  const item = await readCatalogItemByNameForAssert(orgId, name)
  return item?.gtin14 ?? null
}

async function startNewProduct(authedPage: Page): Promise<void> {
  await authedPage.goto('/catalog/new')
  const product = authedPage
    .getByRole('radiogroup', { name: 'Tipo do item' })
    .getByRole('radio', { name: 'Produto' })
  await expect(async () => {
    await product.click()
    await expect(authedPage.locator('input[name="stock"]')).toBeVisible({ timeout: 1000 })
  }).toPass()
}

async function searchAndChoose(authedPage: Page, term: string, optionName: string): Promise<void> {
  const name = authedPage.locator('input[name="name"]')
  await name.click()
  await name.fill(term)
  await authedPage.getByRole('option', { name: new RegExp(optionName, 'i') }).click()
}

async function fillProductName(authedPage: Page, value: string): Promise<void> {
  const nameInput = authedPage.locator('input[name="name"]')
  await nameInput.click()
  await nameInput.fill(value)
  await expect(nameInput).toHaveValue(value)
  await nameInput.press('Escape')
  await expect(authedPage.getByText('Buscando…')).toBeHidden()
  await expect(authedPage.getByRole('listbox')).toBeHidden()
}

async function submitNewItem(authedPage: Page): Promise<void> {
  const criar = authedPage.getByRole('button', { name: 'Criar' })
  await expect(criar).toBeEnabled()
  await criar.click()
  await authedPage.waitForURL(/\/catalog$/)
}

test.describe('Base de Produtos C+D — autofill por código e nome (DoD #1166/#1171)', () => {
  test.use({
    orgInput: { unitCount: 1, memberOperationCount: 1, hasBusinessHours: true, slotMinutes: 30 },
  })

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
    await startNewProduct(authedPage)

    await authedPage.locator('input[name="priceCents"]').fill('8,00')
    await authedPage.locator('input[name="stock"]').fill('3')
    await authedPage.locator('input[name="unitIds"]').first().check()
    await fillProductName(authedPage, 'Manufaturado Próprio')

    await submitNewItem(authedPage)

    expect(await catalogItemGtin14(org.orgId, 'Manufaturado Próprio')).toBeNull()
  })

  if (hasBase) {
    test('Cenário 1: hit — código conhecido preenche e trava o intrínseco', async ({
      org,
      authedPage,
    }, testInfo) => {
      const ns = sovereignBaseNamespace(testInfo.parallelIndex)
      await seedProductBase({ gtin14: ns.knownGtin14, name: ns.knownName, source: 'official' })

      await startNewProduct(authedPage)

      const code = authedPage.getByLabel('Código do produto')
      await code.fill(ns.knownEan13)
      await code.press('Enter')

      const name = authedPage.locator('input[name="name"]')
      await expect(name).toHaveValue(ns.knownName)
      await expect(name).toHaveAttribute('readonly', '')
      await expect(authedPage.getByText(/veio preenchido da base/i)).toBeVisible()

      await authedPage.locator('input[name="priceCents"]').fill('12,90')
      await authedPage.locator('input[name="stock"]').fill('7')
      await authedPage.locator('input[name="unitIds"]').first().check()
      await submitNewItem(authedPage)

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

      const name = authedPage.locator('input[name="name"]')
      await expect(name).not.toHaveAttribute('readonly', '')
      await expect(authedPage.getByText(/dê um nome a este produto/i)).toBeVisible()

      await authedPage.locator('input[name="priceCents"]').fill('3,50')
      await authedPage.locator('input[name="stock"]').fill('20')
      await authedPage.locator('input[name="unitIds"]').first().check()

      await fillProductName(authedPage, ns.contributedName)
      await submitNewItem(authedPage)

      const contributed = await readProductBase(ns.unseenGtin14)
      expect(contributed?.name).toBe(ns.contributedName)
      expect(contributed?.source).toBe('org-contributed')

      expect(await catalogItemGtin14(org.orgId, ns.contributedName)).toBe(ns.unseenGtin14)

      await startNewProduct(authedPage)
      const code2 = authedPage.getByLabel('Código do produto')
      await code2.fill(ns.unseenEan13)
      await code2.press('Enter')
      const name2 = authedPage.locator('input[name="name"]')
      await expect(name2).toHaveValue(ns.contributedName)
      await expect(name2).toHaveAttribute('readonly', '')
    })

    test('D · Cenário 1: busca por nome → escolher → referencia (read-only, gtin14)', async ({
      org,
      authedPage,
    }, testInfo) => {
      const ns = sovereignBaseNamespace(testInfo.parallelIndex)
      await seedProductBase({ gtin14: ns.knownGtin14, name: ns.knownName, source: 'official' })

      await startNewProduct(authedPage)
      await searchAndChoose(authedPage, ns.knownSearchTerm, ns.knownName)

      const name = authedPage.locator('input[name="name"]')
      await expect(name).toHaveValue(ns.knownName)
      await expect(name).toHaveAttribute('readonly', '')

      await authedPage.locator('input[name="priceCents"]').fill('12,90')
      await authedPage.locator('input[name="stock"]').fill('7')
      await authedPage.locator('input[name="unitIds"]').first().check()
      await submitNewItem(authedPage)

      expect(await catalogItemGtin14(org.orgId, ns.knownName)).toBe(ns.knownGtin14)
    })

    test('D · Cenário 2: similaridade tolera erro de digitação (typo ainda acha)', async ({
      authedPage,
    }, testInfo) => {
      const ns = sovereignBaseNamespace(testInfo.parallelIndex)
      await seedProductBase({ gtin14: ns.knownGtin14, name: ns.knownName, source: 'official' })

      await startNewProduct(authedPage)
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

      await authedPage.locator('input[name="priceCents"]').fill('5,00')
      await authedPage.locator('input[name="stock"]').fill('10')
      await authedPage.locator('input[name="unitIds"]').first().check()

      await fillProductName(authedPage, 'Parafuso Sextavado Inox')

      await expect(name).toBeEditable()

      await submitNewItem(authedPage)

      expect(await catalogItemGtin14(org.orgId, 'Parafuso Sextavado Inox')).toBeNull()
    })
  }
})
