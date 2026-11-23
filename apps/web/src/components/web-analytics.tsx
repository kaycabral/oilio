'use client'

import { redactAnalyticsEvent } from '@/shared/observability/web-analytics'
import { Analytics } from '@vercel/analytics/next'

export function WebAnalytics() {
  return <Analytics beforeSend={redactAnalyticsEvent} />
}
