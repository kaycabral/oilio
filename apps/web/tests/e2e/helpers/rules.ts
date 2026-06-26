import { expect } from '../fixtures'

// Asserts the discriminated-union result is the `ok: true` variant and narrows
// it for the caller. Replaces the `expect(res.ok).toBe(true); if (res.ok) {…}`
// idiom — the `if` is a TypeScript narrowing crutch, not runtime branching, and
// trips playwright/no-conditional-expect. Asserting unconditionally keeps the
// type narrowing while letting the field assertions run flat.
export function assertOk<T extends { ok: boolean }>(
  res: T,
): asserts res is Extract<T, { ok: true }> {
  expect(res.ok).toBe(true)
}

// Narrows away `undefined`/`null` for a setup precondition (e.g. indexing a
// fixture array under noUncheckedIndexedAccess). Replaces the `if (!x) throw`
// guard that trips playwright/no-conditional-in-test — the branch is a type
// crutch, not test logic. Keeping the assertion in a helper moves the `if` out
// of the test body.
export function assertDefined<T>(value: T, message: string): asserts value is NonNullable<T> {
  expect(value, message).toBeDefined()
  expect(value, message).not.toBeNull()
}
