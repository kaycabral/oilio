import { generateHourlyNotifications } from '@/features/notifications/adapters/generate-hourly'
import { PostgresLayerLive } from '@/shared/db/effect'
import { withRequestContext } from '@/shared/lib/request-context'
import { Effect } from 'effect'
import { NextResponse } from 'next/server'

function verifyCronSecret(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const header = request.headers.get('x-cron-secret')
  return header === secret
}

async function postHandler(request: Request) {
  if (!verifyCronSecret(request)) {
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

export const POST = withRequestContext(postHandler)
