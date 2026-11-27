import { reconcileBillingQuantities } from '@/features/billing/adapters/reconcile-billing'
import { isAuthorizedCron } from '@/shared/cron-auth'
import { withRequestContext } from '@cbrl/log'
import { NextResponse } from 'next/server'

async function postHandler(request: Request): Promise<Response> {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const reconciled = await reconcileBillingQuantities()
  return NextResponse.json({ ok: true, reconciled })
}

export const GET = withRequestContext(postHandler)
export const POST = withRequestContext(postHandler)
