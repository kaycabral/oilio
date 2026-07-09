import { expect, type Locator } from '@playwright/test'

export async function fillStable(locator: Locator, value: string): Promise<void> {
  const chars = value.replace(/\W/g, '').split('')
  const masked = new RegExp('^\\W*' + chars.map(escapeRegExp).join('\\W*') + '\\W*$')
  await expect(async () => {
    await locator.fill(value)
    await expect(locator).toHaveValue(masked, { timeout: 2_000 })
  }).toPass({ timeout: 15_000 })
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export async function checkStable(locator: Locator): Promise<void> {
  await expect(async () => {
    if (!(await locator.isChecked())) await locator.click()
    await expect(locator).toBeChecked({ timeout: 1000 })
  }).toPass({ timeout: 10_000 })
}
