import type { ErrorEvent, EventHint } from '@sentry/nextjs'

export const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN ?? null

export const SENTRY_ENABLED = SENTRY_DSN !== null && process.env.NODE_ENV === 'production'

export const SENTRY_ENVIRONMENT = process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT

export function scrubEvent(event: ErrorEvent, _hint: EventHint): ErrorEvent | null {
  if (event.request) {
    delete event.request.cookies
    delete event.request.headers
    if (typeof event.request.query_string === 'string') {
      delete event.request.query_string
    }
    if (typeof event.request.url === 'string') {
      event.request.url = event.request.url.replace(/([?&])token=[^&]*/gi, '$1token=[redacted]')
    }
  }
  if (event.user) {
    delete event.user.ip_address
    delete event.user.email
    delete event.user.username
  }
  return event
}
