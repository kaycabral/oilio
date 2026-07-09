import { expect, type Locator, type Page } from '@playwright/test'
import { checkStable } from './hydration'

export async function fillBirthDate(
  page: Page,
  value: string,
  label: string | RegExp = /data de nascimento/i,
): Promise<void> {
  await page.getByRole('textbox', { name: label }).fill(value)
}

export function isoToBrDate(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

export async function fillCatalogName(page: Page, value: string): Promise<void> {
  const name = page.locator('input[name="name"]')
  await name.click()
  await name.fill(value)
  await expect(name).toHaveValue(value)
  await name.press('Escape')
}

export async function enableUnitBusinessHours(
  scope: Page | Locator,
  day = 'monday',
): Promise<void> {
  await checkStable(scope.locator(`#bh_${day}`))
}
