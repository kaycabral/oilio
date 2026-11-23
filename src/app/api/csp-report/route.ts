import { logger, withRequestContext } from '@cbrl/log'
import { cspReportRoute } from '@cbrl/next/server'

export const runtime = 'nodejs'

const handler = cspReportRoute({
  onReport: (violation) => {
    logger.warn('csp violation', { scope: 'csp', ...violation })
  },
})

export const POST = withRequestContext(handler)
