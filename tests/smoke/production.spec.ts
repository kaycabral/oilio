import { requireEnv } from '@cbrl/env'
import { smokeSuite } from '@cbrl/testing/playwright'
import { expect, test } from '@playwright/test'

const expectedCommit = requireEnv('SMOKE_EXPECTED_COMMIT')
const supabaseOrigin = new URL(requireEnv('SMOKE_SUPABASE_URL')).origin

smokeSuite()

test('health answers from the deployed commit with the database reachable', async ({ request }) => {
  const res = await request.get('/api/health')

  expect(res.status()).toBe(200)
  expect(await res.json()).toEqual({ status: 'ok', database: 'ok', commit: expectedCommit })
})

for (const path of ['/', '/login']) {
  test(`${path} ships the security headers`, async ({ request }) => {
    const res = await request.get(path)
    const headers = res.headers()

    expect(res.status()).toBe(200)
    expect(headers['content-security-policy-report-only']).toContain("default-src 'self'")
    expect(headers['content-security-policy-report-only']).toContain(
      `connect-src 'self' ${supabaseOrigin}`,
    )
    expect(headers['content-security-policy-report-only']).toContain('report-to csp-endpoint')
    expect(headers['reporting-endpoints']).toBe('csp-endpoint="/api/csp-report"')
    expect(headers['strict-transport-security']).toMatch(/^max-age=\d{8,}; includeSubDomains/)
    expect(headers['x-content-type-options']).toBe('nosniff')
    expect(headers['x-frame-options']).toBe('DENY')
  })
}

test('Google sign-in starts at the production Supabase project', async ({ page, baseURL }) => {
  await page.route('https://accounts.google.com/**', (route) => route.abort())
  await page.goto('/login')
  const authorize = page.waitForRequest((req) =>
    req.url().startsWith(`${supabaseOrigin}/auth/v1/authorize`),
  )
  const google = page.waitForRequest((req) => req.url().startsWith('https://accounts.google.com/'))

  await page.getByRole('button', { name: 'Continuar com Google' }).click()

  const authorizeUrl = new URL((await authorize).url())
  const redirectTo = new URL(authorizeUrl.searchParams.get('redirect_to') ?? '')
  expect(authorizeUrl.searchParams.get('provider')).toBe('google')
  expect(authorizeUrl.searchParams.get('code_challenge')).toBeTruthy()
  expect(redirectTo.origin).toBe(new URL(baseURL ?? '').origin)
  expect(redirectTo.pathname).toBe('/auth/callback')

  const googleUrl = new URL((await google).url())
  expect(googleUrl.searchParams.get('client_id')).toMatch(/\.apps\.googleusercontent\.com$/)
  expect(googleUrl.searchParams.get('redirect_uri')).toBe(`${supabaseOrigin}/auth/v1/callback`)
  expect(googleUrl.searchParams.get('prompt')).toBe('select_account')
})
