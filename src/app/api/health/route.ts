import { getEventStorePool } from '@/shared/db/pg/pool'
import { logger, withRequestContext } from '@cbrl/log'
import { healthRoute } from '@cbrl/next/server'

const handler = healthRoute({
  ping: () => getEventStorePool().query('SELECT 1'),
  onError: (err) => {
    logger.warn('health ping failed', { scope: 'health', err })
  },
})

export const GET = withRequestContext(handler)
