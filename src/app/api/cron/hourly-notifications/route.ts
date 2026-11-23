import { generateHourlyNotifications } from '@/features/notifications/adapters/generate-hourly'
import { flagNotFound } from '@/shared/api-flags'
import { isAuthorizedCron } from '@/shared/cron-auth'
import { PostgresLayerLive } from '@/shared/db/effect'
import { withRequestContext } from '@cbrl/log'
import { Effect } from 'effect'
import { NextResponse } from 'next/server'

async function postHandler(request: Request) {
  const disabled = flagNotFound('notifications')
  if (disabled) return disabled

  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const created = await Effect.runPromise(
    generateHourlyNotifications().pipe(
      Effect.catchAll(() => Effect.succeed(0)),
      Effect.provide(PostgresLayerLive),
    ),
  )

  return NextResponse.json({ ok: true, created })
}

export const GET = withRequestContext(postHandler)
export const POST = withRequestContext(postHandler)
