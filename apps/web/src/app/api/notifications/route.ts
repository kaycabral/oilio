import { allowedNotificationTypesForRole } from '@/domain'
import { fetchUnitNotifications } from '@/features/notifications/adapters/query'
import { getAdminFirestore } from '@/shared/db'
import { getSessionUser } from '@/shared/firebase/admin'
import { getActiveTenantContext } from '@/shared/tenant/membership'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const session = await getSessionUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const ctx = await getActiveTenantContext(session.uid)
  if (!ctx) return NextResponse.json({ error: 'No tenant' }, { status: 403 })

  const unitId = request.nextUrl.searchParams.get('unitId')
  if (!unitId) return NextResponse.json({ error: 'unitId required' }, { status: 400 })

  const limit = Math.min(Number(request.nextUrl.searchParams.get('limit') ?? '10'), 50)

  const allowedTypes = allowedNotificationTypesForRole(ctx.membership.role)
  const result = await fetchUnitNotifications({
    db: getAdminFirestore(),
    tenantId: ctx.membership.tenantId,
    unitId,
    limit,
    now: new Date(),
    allowedTypes,
  })

  return NextResponse.json(result)
}
