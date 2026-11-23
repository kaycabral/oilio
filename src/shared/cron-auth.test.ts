import { afterEach, describe, expect, it, vi } from 'vitest'
import { isAuthorizedCron } from './cron-auth'

function request(authorization?: string): Request {
  return new Request('https://oilio.test/api/cron/x', {
    headers: authorization ? { authorization } : {},
  })
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('isAuthorizedCron', () => {
  it('accepts the Vercel Cron bearer header', () => {
    vi.stubEnv('CRON_SECRET', 's3cret-value')
    expect(isAuthorizedCron(request('Bearer s3cret-value'))).toBe(true)
  })

  it('rejects a wrong or missing secret', () => {
    vi.stubEnv('CRON_SECRET', 's3cret-value')
    expect(isAuthorizedCron(request('Bearer wrong-value'))).toBe(false)
    expect(isAuthorizedCron(request('s3cret-value'))).toBe(false)
    expect(isAuthorizedCron(request())).toBe(false)
  })

  it('fails closed when CRON_SECRET is unset', () => {
    vi.stubEnv('CRON_SECRET', '')
    expect(isAuthorizedCron(request('Bearer '))).toBe(false)
  })
})
