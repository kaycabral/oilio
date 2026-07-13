import { afterEach, describe, expect, it } from 'vitest'

import { isFeatureEnabled } from './flags'

const VARS = [
  'NEXT_PUBLIC_FF_FINANCE',
  'NEXT_PUBLIC_FF_COPILOT',
  'NEXT_PUBLIC_FF_NOTIFICATIONS',
] as const

afterEach(() => {
  for (const v of VARS) delete process.env[v]
})

describe('isFeatureEnabled', () => {
  it('hides every feature by default (fail-safe)', () => {
    expect(isFeatureEnabled('finance')).toBe(false)
    expect(isFeatureEnabled('copilot')).toBe(false)
    expect(isFeatureEnabled('notifications')).toBe(false)
  })

  it('enables a feature only when its own flag is on', () => {
    process.env.NEXT_PUBLIC_FF_FINANCE = 'true'
    expect(isFeatureEnabled('finance')).toBe(true)
    expect(isFeatureEnabled('copilot')).toBe(false)
    expect(isFeatureEnabled('notifications')).toBe(false)
  })

  it('accepts "1" and is case/space-insensitive', () => {
    process.env.NEXT_PUBLIC_FF_COPILOT = '1'
    expect(isFeatureEnabled('copilot')).toBe(true)
    process.env.NEXT_PUBLIC_FF_NOTIFICATIONS = '  TRUE '
    expect(isFeatureEnabled('notifications')).toBe(true)
  })

  it('stays off for any other value', () => {
    for (const raw of ['false', '0', 'yes', 'on']) {
      process.env.NEXT_PUBLIC_FF_FINANCE = raw
      expect(isFeatureEnabled('finance')).toBe(false)
    }
  })
})
