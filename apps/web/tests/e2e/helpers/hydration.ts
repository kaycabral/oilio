import { expect, type Locator } from '@playwright/test'

// React-controlled inputs/switches under parallel E2E load: an interaction that
// lands before the page hydrates is silently dropped — the SSR'd markup hasn't
// wired its React onChange/onClick yet, and once hydration takes over a
// controlled input it resets to its initial state. Retry the interaction until
// it takes effect. This is "fix the flake" (a resilient interaction), not
// retry-masking of a product bug: the effect is deterministic once hydrated.

export async function fillStable(locator: Locator, value: string): Promise<void> {
  // Compare mask-insensitively (e.g. a CEP field reformats 01310100 ->
  // 01310-100): we only need to confirm the fill stuck, not its display format.
  const normalize = (s: string) => s.replace(/\W/g, '')
  await expect(async () => {
    await locator.fill(value)
    expect(normalize(await locator.inputValue())).toBe(normalize(value))
  }).toPass({ timeout: 10_000 })
}

// Toggle a switch/checkbox to the checked state, resilient to a pre-hydration
// click being dropped.
export async function checkStable(locator: Locator): Promise<void> {
  await expect(async () => {
    if (!(await locator.isChecked())) await locator.click()
    await expect(locator).toBeChecked({ timeout: 1000 })
  }).toPass({ timeout: 10_000 })
}
