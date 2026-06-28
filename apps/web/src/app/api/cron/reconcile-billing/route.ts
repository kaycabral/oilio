import { reconcileBillingQuantities } from '@/features/billing/adapters/reconcile-billing'
import { NextResponse } from 'next/server'

// Billing reconciliation cron (brief 0074, AC-04). Re-asserts that each actively-
// subscribed Negócio's Stripe subscription quantity matches its live unit count,
// closing any drift left by the best-effort post-commit sync. Auth + shape molded
// on `reconcile-products/route.ts`: verifies the cron secret, runs the per-org-
// tolerant sweep, returns the number of orgs reconciled.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function verifyCronSecret(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const header = request.headers.get('x-cron-secret')
  return header === secret
}

export async function POST(request: Request): Promise<Response> {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const reconciled = await reconcileBillingQuantities()
  return NextResponse.json({ ok: true, reconciled })
}
