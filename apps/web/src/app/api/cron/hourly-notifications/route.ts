import { generateHourlyNotifications } from '@/features/notifications/adapters/generate-hourly'
import { FirestoreLayerLive } from '@/shared/db/effect'
import { Effect } from 'effect'
import { NextResponse } from 'next/server'

function verifyCronSecret(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const header = request.headers.get('x-cron-secret')
  return header === secret
}

export async function POST(request: Request) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const created = await Effect.runPromise(
    generateHourlyNotifications().pipe(
      Effect.catchAll(() => Effect.succeed(0)),
      Effect.provide(FirestoreLayerLive),
    ),
  )

  return NextResponse.json({ ok: true, created })
}
