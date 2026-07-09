import { reconcileBillingQuantities } from '@/features/billing/adapters/reconcile-billing'
import { withRequestContext } from '@/shared/lib/request-context'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function verifyCronSecret(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const header = request.headers.get('x-cron-secret')
  return header === secret
}

async function postHandler(request: Request): Promise<Response> {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const reconciled = await reconcileBillingQuantities()
  return NextResponse.json({ ok: true, reconciled })
}

export const POST = withRequestContext(postHandler)
