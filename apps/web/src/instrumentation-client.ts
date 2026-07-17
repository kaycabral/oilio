import * as Sentry from '@sentry/nextjs'

import {
  scrubEvent,
  SENTRY_DSN,
  SENTRY_ENABLED,
  SENTRY_ENVIRONMENT,
} from './shared/observability/sentry-shared'

Sentry.init({
  dsn: SENTRY_DSN ?? undefined,
  enabled: SENTRY_ENABLED,
  environment: SENTRY_ENVIRONMENT,
  sendDefaultPii: false,
  tracesSampleRate: 0.1,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,
  beforeSend: scrubEvent,
})

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
