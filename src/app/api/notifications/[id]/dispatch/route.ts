import { dispatchNotificationWhatsapp } from '@/features/notifications/adapters/dispatch'
import { flagNotFound } from '@/shared/api-flags'
import { getSessionUser } from '@/shared/auth/session'
import { getActiveOrgContext } from '@/shared/org/membership'
import { withRequestContext } from '@cbrl/log'
import { NextResponse } from 'next/server'

async function postHandler(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const disabled = flagNotFound('notifications')
  if (disabled) return disabled

  const session = await getSessionUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const ctx = await getActiveOrgContext(session.uid)
  if (!ctx) return NextResponse.json({ error: 'No org' }, { status: 403 })

  const { id } = await params

  const result = await dispatchNotificationWhatsapp(ctx.membership.orgId, id, session.uid)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })

  return NextResponse.json({ link: result.link })
}

export const POST = withRequestContext(postHandler)
