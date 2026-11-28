import { generateDailyNotifications } from '@/features/notifications/adapters/generate-daily'
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

  const url = new URL(request.url)
  const nowParam = url.searchParams.get('now')
  const now = nowParam ? new Date(nowParam) : new Date()

  const created = await Effect.runPromise(
    generateDailyNotifications(now).pipe(
      Effect.catch(() => Effect.succeed(0)),
      Effect.provide(PostgresLayerLive),
    ),
  )

  return NextResponse.json({ ok: true, created })
}

export const GET = withRequestContext(postHandler)
export const POST = withRequestContext(postHandler)
