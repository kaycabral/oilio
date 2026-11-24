import { describe, expect, it } from 'vitest'

import { stripeEndpoint } from './stripe-client'

describe('stripeEndpoint', () => {
  it('keeps the SDK default host when no override is set', () => {
    expect(stripeEndpoint('sk_live_abc', undefined)).toEqual({})
    expect(stripeEndpoint('sk_live_abc', '')).toEqual({})
  })

  it('points the SDK at the override for a test-mode key', () => {
    expect(stripeEndpoint('sk_test_abc', 'http://127.0.0.1:12111')).toEqual({
      host: '127.0.0.1',
      port: 12111,
      protocol: 'http',
    })
    expect(stripeEndpoint('rk_test_abc', 'https://stripe-mock.internal:12112')).toEqual({
      host: 'stripe-mock.internal',
      port: 12112,
      protocol: 'https',
    })
  })

  it('refuses to send a live key to an override', () => {
    expect(() => stripeEndpoint('sk_live_abc', 'http://127.0.0.1:12111')).toThrow(/test-mode/)
    expect(() => stripeEndpoint('rk_live_abc', 'http://127.0.0.1:12111')).toThrow(/test-mode/)
  })

  it('rejects a malformed override', () => {
    expect(() => stripeEndpoint('sk_test_abc', 'not a url')).toThrow()
    expect(() => stripeEndpoint('sk_test_abc', 'ftp://127.0.0.1:21')).toThrow(/http/)
    expect(() => stripeEndpoint('sk_test_abc', 'http://127.0.0.1')).toThrow(/port/)
  })
})
