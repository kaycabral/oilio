import { expect, type Locator } from '@playwright/test'

// React-controlled inputs/switches under parallel E2E load: an interaction that
// lands before the page hydrates is silently dropped — the SSR'd markup hasn't
// wired its React onChange/onClick yet, and once hydration takes over a
// controlled input it resets to its initial state. Retry the interaction until
// it takes effect. This is "fix the flake" (a resilient interaction), not
// retry-masking of a product bug: the effect is deterministic once hydrated.

export async function fillStable(locator: Locator, value: string): Promise<void> {
  // A masked field reformats the display (a CEP field turns 01310100 into
  // 01310-100), so we can't assert the exact string. Build a mask-tolerant
  // RegExp — the digits/letters of `value` in order, allowing any non-word
  // chars between them — and let the web-first `toHaveValue` prove the fill
  // landed. Per Playwright's guidance, `toHaveValue(RegExp)` AUTO-RETRIES the
  // value read, so a value that settles a tick after hydration is still caught
  // (unlike a one-shot `inputValue()` snapshot).
  const chars = value.replace(/\W/g, '').split('')
  const masked = new RegExp('^\\W*' + chars.map(escapeRegExp).join('\\W*') + '\\W*$')
  // Outer `.toPass` re-fires the fill itself: a controlled React input reverts a
  // pre-hydration fill to its initial state, so the interaction (not just the
  // assertion) must be retried until hydration wires the onChange. 15s absorbs
  // slow hydration of heavy routes under parallel load without masking a real
  // bug — the fill is deterministic once hydrated.
  await expect(async () => {
    await locator.fill(value)
    await expect(locator).toHaveValue(masked, { timeout: 2_000 })
  }).toPass({ timeout: 15_000 })
}

// Escape a literal string for safe embedding in a RegExp.
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Toggle a switch/checkbox to the checked state, resilient to a pre-hydration
// click being dropped.
export async function checkStable(locator: Locator): Promise<void> {
  await expect(async () => {
    if (!(await locator.isChecked())) await locator.click()
    await expect(locator).toBeChecked({ timeout: 1000 })
  }).toPass({ timeout: 10_000 })
}
