import { markNotificationRead } from '@/features/notifications/adapters/mark'
import { getSessionUser } from '@/shared/firebase/admin'
import { getActiveOrgContext } from '@/shared/org/membership'
import { NextResponse } from 'next/server'

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const ctx = await getActiveOrgContext(session.uid)
  if (!ctx) return NextResponse.json({ error: 'No org' }, { status: 403 })

  const { id } = await params
  const result = await markNotificationRead(ctx.membership.orgId, id, session.uid)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })

  return NextResponse.json({ ok: true })
}
