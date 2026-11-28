import { reconcilePendingProducts } from '@/features/catalog/adapters/reconcile-products'
import { isAuthorizedCron } from '@/shared/cron-auth'
import { PostgresLayerLive } from '@/shared/db/effect'
import { withRequestContext } from '@cbrl/log'
import { Effect } from 'effect'
import { NextResponse } from 'next/server'

async function postHandler(request: Request) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(request.url)
  const nowParam = url.searchParams.get('now')
  const parsedNow = nowParam ? new Date(nowParam) : new Date()
  const now = Number.isNaN(parsedNow.getTime()) ? new Date() : parsedNow

  const reconciled = await Effect.runPromise(
    reconcilePendingProducts(now).pipe(
      Effect.catchDefect(() => Effect.succeed(0)),
      Effect.provide(PostgresLayerLive),
    ),
  )

  return NextResponse.json({ ok: true, reconciled })
}

export const GET = withRequestContext(postHandler)
export const POST = withRequestContext(postHandler)
