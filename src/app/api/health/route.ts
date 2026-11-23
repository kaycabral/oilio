import { getEventStorePool } from '@/shared/db/pg/pool'
import { logger, withRequestContext } from '@cbrl/log'
import { healthRoute } from '@cbrl/next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const handler = healthRoute({
  ping: () => getEventStorePool().query('SELECT 1'),
  onError: (err) => {
    logger.warn('health ping failed', { scope: 'health', err })
  },
})

export const GET = withRequestContext(handler)
