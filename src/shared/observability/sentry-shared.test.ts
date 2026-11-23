import type { ErrorEvent } from '@sentry/nextjs'
import { describe, expect, it } from 'vitest'

import { scrubEvent, SENTRY_DATA_COLLECTION } from '@/shared/observability/sentry-shared'

describe('SENTRY_DATA_COLLECTION', () => {
  it('opts out of every personal-data category the SDK would collect by default', () => {
    expect(SENTRY_DATA_COLLECTION).toEqual({
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      genAI: { inputs: false, outputs: false },
      mcp: { inputs: false, outputs: false },
      graphQL: { document: false, variables: false },
      databaseQueryData: false,
      queues: false,
    })
  })
})

describe('scrubEvent', () => {
  it('drops cookies, headers, query string and user identifiers, and redacts token params', () => {
    const event: ErrorEvent = {
      type: undefined,
      request: {
        url: 'https://app.example/invite?token=secret&x=1',
        cookies: { sb: 'session' },
        headers: { authorization: 'Bearer abc' },
        query_string: 'token=secret&x=1',
      },
      user: { id: 'u1', ip_address: '10.0.0.1', email: 'a@b.c', username: 'ana' },
    }

    const scrubbed = scrubEvent(event, {})

    expect(scrubbed?.request).toEqual({ url: 'https://app.example/invite?token=[redacted]&x=1' })
    expect(scrubbed?.user).toEqual({ id: 'u1' })
  })
})
