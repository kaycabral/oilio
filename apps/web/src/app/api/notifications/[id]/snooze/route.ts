import { snoozeNotification } from '@/features/notifications/adapters/mark'
import { isSnoozeOption } from '@/features/notifications/core/snooze'
import { getSessionUser } from '@/shared/firebase/admin'
import { readJson } from '@/shared/http'
import { getActiveTenantContext } from '@/shared/tenant/membership'
import { getTenant } from '@/shared/tenant/tenant'
import { Schema } from 'effect'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

const SnoozeBodySchema = Schema.Struct({
  option: Schema.optional(Schema.String),
})

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const ctx = await getActiveTenantContext(session.uid)
  if (!ctx) return NextResponse.json({ error: 'No tenant' }, { status: 403 })

  const body = await readJson(request, Schema.decodeUnknownSync(SnoozeBodySchema)).catch(
    (): { option?: string } => ({}),
  )
  if (!body.option || !isSnoozeOption(body.option)) {
    return NextResponse.json({ error: 'Opção de adiamento inválida' }, { status: 400 })
  }

  const tenant = await getTenant(ctx.membership.tenantId)
  if (!tenant) return NextResponse.json({ error: 'Tenant não encontrado' }, { status: 404 })

  const { id } = await params
  const result = await snoozeNotification({
    tenantId: ctx.membership.tenantId,
    notificationId: id,
    option: body.option,
    actorUid: session.uid,
    tz: tenant.timezone,
  })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })

  return NextResponse.json({ ok: true })
}
