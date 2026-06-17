import { dispatchNotificationWhatsapp } from '@/features/notifications/adapters/dispatch'
import { getSessionUser } from '@/shared/firebase/admin'
import { getActiveTenantContext } from '@/shared/tenant/membership'
import { NextResponse } from 'next/server'

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const ctx = await getActiveTenantContext(session.uid)
  if (!ctx) return NextResponse.json({ error: 'No tenant' }, { status: 403 })

  const { id } = await params

  const result = await dispatchNotificationWhatsapp(ctx.membership.tenantId, id, session.uid)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })

  return NextResponse.json({ link: result.link })
}
