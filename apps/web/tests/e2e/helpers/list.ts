import { expect, type Locator, type Page } from '@playwright/test'

export function listItem(page: Page, text: string | RegExp): Locator {
  return page.getByRole('listitem').filter({ hasText: text })
}

export function rowActionsTrigger(row: Locator): Locator {
  return row.getByRole('button', { name: /^Ações\b/ })
}

export async function rowAction(
  page: Page,
  rowText: string | RegExp,
  action: string | RegExp,
): Promise<void> {
  const row = listItem(page, rowText)
  await expect(row).toBeVisible()
  await rowActionsTrigger(row).click()
  await page.getByRole('menuitem', { name: action }).click()
}
