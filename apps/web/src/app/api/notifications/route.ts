import { allowedNotificationTypesForRole } from '@/domain'
import { getSessionUser } from '@/shared/firebase/admin'
import { withRequestContext } from '@/shared/lib/request-context'
import { getActiveOrgContext } from '@/shared/org/membership'
import { fetchUnreadNotificationsForUnit } from '@/shared/org/notification-read'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

async function getHandler(request: NextRequest) {
  const session = await getSessionUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const ctx = await getActiveOrgContext(session.uid)
  if (!ctx) return NextResponse.json({ error: 'No org' }, { status: 403 })

  const unitId = request.nextUrl.searchParams.get('unitId')
  if (!unitId) return NextResponse.json({ error: 'unitId required' }, { status: 400 })

  const limit = Math.min(Number(request.nextUrl.searchParams.get('limit') ?? '10'), 50)

  const allowedTypes = allowedNotificationTypesForRole(ctx.membership.role)
  const result = await fetchUnreadNotificationsForUnit({
    orgId: ctx.membership.orgId,
    unitId,
    limit,
    now: new Date(),
    allowedTypes,
  })

  return NextResponse.json(result)
}

export const GET = withRequestContext(getHandler)
