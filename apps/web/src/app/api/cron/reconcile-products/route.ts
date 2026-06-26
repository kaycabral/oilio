import { reconcilePendingProducts } from '@/features/catalog/adapters/reconcile-products'
import { PostgresLayerLive } from '@/shared/db/effect'
import { Effect } from 'effect'
import { NextResponse } from 'next/server'

// Reconciliation cron (brief 0050, AC-08). Reprocesses the catalog items whose
// sovereign-base contribution was deferred (base was down at registration).
// Molded on `daily-notifications/route.ts`: verifies the cron secret, runs the
// per-item-tolerant generator, returns the reconciled count.

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

  const url = new URL(request.url)
  const nowParam = url.searchParams.get('now')
  // Guard against a malformed `?now=` — `new Date('garbage')` is an Invalid Date
  // (not null), which would later throw on `.toISOString()` and abort the sweep.
  const parsedNow = nowParam ? new Date(nowParam) : new Date()
  const now = Number.isNaN(parsedNow.getTime()) ? new Date() : parsedNow

  const reconciled = await Effect.runPromise(
    reconcilePendingProducts(now).pipe(
      Effect.catchAllDefect(() => Effect.succeed(0)),
      Effect.provide(PostgresLayerLive),
    ),
  )

  return NextResponse.json({ ok: true, reconciled })
}
