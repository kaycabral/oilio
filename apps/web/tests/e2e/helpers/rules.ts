import { expect } from '../fixtures'

export function assertOk<T extends { ok: boolean }>(
  res: T,
): asserts res is Extract<T, { ok: true }> {
  expect(res.ok).toBe(true)
}

export function assertDefined<T>(value: T, message: string): asserts value is NonNullable<T> {
  expect(value, message).toBeDefined()
  expect(value, message).not.toBeNull()
}
