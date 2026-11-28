import { logger, withRequestContext } from '@cbrl/log'
import { cspReportRoute } from '@cbrl/next/server'

const handler = cspReportRoute({
  onReport: (violation) => {
    logger.warn('csp violation', { scope: 'csp', ...violation })
  },
})

export const POST = withRequestContext(handler)
