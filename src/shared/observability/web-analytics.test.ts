import { describe, expect, it } from 'vitest'

import { redactAnalyticsEvent, redactAnalyticsUrl } from '@/shared/observability/web-analytics'

const ORIGIN = 'https://app.example.com'

describe('redactAnalyticsUrl', () => {
  it('drops the query string and the fragment', () => {
    expect(redactAnalyticsUrl(`${ORIGIN}/login?next=%2Fdashboard#top`)).toBe(`${ORIGIN}/login`)
  })

  it('redacts the invite ids and drops the invite token', () => {
    expect(redactAnalyticsUrl(`${ORIGIN}/invites/org-123/inv-456?token=s3cr3t`)).toBe(
      `${ORIGIN}/invites/[orgId]/[inviteId]`,
    )
  })

  it.each([
    ['/customers/c-1', '/customers/[id]'],
    ['/team/u-1', '/team/[userId]'],
    ['/orders/o-1', '/orders/[id]'],
    ['/subscriptions/s-1', '/subscriptions/[id]'],
    ['/catalog/i-1', '/catalog/[id]'],
    ['/plans/p-1', '/plans/[id]'],
    ['/units/n-1', '/units/[id]'],
  ])('redacts the record id in %s', (path, expected) => {
    expect(redactAnalyticsUrl(`${ORIGIN}${path}`)).toBe(`${ORIGIN}${expected}`)
  })

  it('redacts the id in nested paths and keeps the rest', () => {
    expect(redactAnalyticsUrl(`${ORIGIN}/customers/c-1/history/`)).toBe(
      `${ORIGIN}/customers/[id]/history/`,
    )
  })

  it.each(['/catalog/new', '/plans/new', '/subscriptions/new', '/units/new'])(
    'keeps the static route %s',
    (path) => {
      expect(redactAnalyticsUrl(`${ORIGIN}${path}`)).toBe(`${ORIGIN}${path}`)
    },
  )

  it('keeps public booking slugs', () => {
    expect(redactAnalyticsUrl(`${ORIGIN}/barbearia-centro/unidade-sul/book?slot=10h`)).toBe(
      `${ORIGIN}/barbearia-centro/unidade-sul/book`,
    )
  })

  it('keeps routes without identifiers', () => {
    expect(redactAnalyticsUrl(`${ORIGIN}/`)).toBe(`${ORIGIN}/`)
    expect(redactAnalyticsUrl(`${ORIGIN}/customers`)).toBe(`${ORIGIN}/customers`)
  })

  it('returns null for an unparseable url', () => {
    expect(redactAnalyticsUrl('not a url')).toBeNull()
  })
})

describe('redactAnalyticsEvent', () => {
  it('rewrites the url and keeps the event type', () => {
    expect(
      redactAnalyticsEvent({ type: 'pageview', url: `${ORIGIN}/team/u-1?tab=profile` }),
    ).toEqual({ type: 'pageview', url: `${ORIGIN}/team/[userId]` })
  })

  it('drops the event when the url cannot be parsed', () => {
    expect(redactAnalyticsEvent({ type: 'event', url: '::' })).toBeNull()
  })
})
