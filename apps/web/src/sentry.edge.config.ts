import * as Sentry from '@sentry/nextjs'

import {
  scrubEvent,
  SENTRY_DATA_COLLECTION,
  SENTRY_DSN,
  SENTRY_ENABLED,
  SENTRY_ENVIRONMENT,
} from './shared/observability/sentry-shared'

Sentry.init({
  dsn: SENTRY_DSN ?? undefined,
  enabled: SENTRY_ENABLED,
  environment: SENTRY_ENVIRONMENT,
  dataCollection: SENTRY_DATA_COLLECTION,
  tracesSampleRate: 0.1,
  beforeSend: scrubEvent,
})
