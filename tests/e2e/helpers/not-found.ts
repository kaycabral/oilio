import { expect, type Page } from '@playwright/test'

export async function expectNotFound(page: Page, path: string): Promise<void> {
  await page.goto(path)
  await expect(page.getByText('This page could not be found.')).toBeVisible()
  await expect(page.locator('meta[name="robots"][content*="noindex"]')).not.toHaveCount(0)
}

export async function expectHttpNotFound(page: Page, path: string): Promise<void> {
  const response = await page.goto(path)
  expect(response?.status(), `${path} deve responder 404`).toBe(404)
  await expect(page.getByText('This page could not be found.')).toBeVisible()
}
