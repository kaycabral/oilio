import { snoozeNotification } from '@/features/notifications/adapters/mark'
import { isSnoozeOption } from '@/features/notifications/core/snooze'
import { getSessionUser } from '@/shared/firebase/admin'
import { readJson } from '@/shared/http'
import { getActiveOrgContext } from '@/shared/org/membership'
import { getOrg } from '@/shared/org/org'
import { Schema } from 'effect'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

const SnoozeBodySchema = Schema.Struct({
  option: Schema.optional(Schema.String),
})

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const ctx = await getActiveOrgContext(session.uid)
  if (!ctx) return NextResponse.json({ error: 'No org' }, { status: 403 })

  const body = await readJson(request, Schema.decodeUnknownSync(SnoozeBodySchema)).catch(
    (): { option?: string } => ({}),
  )
  if (!body.option || !isSnoozeOption(body.option)) {
    return NextResponse.json({ error: 'Opção de adiamento inválida' }, { status: 400 })
  }

  const org = await getOrg(ctx.membership.orgId)
  if (!org) return NextResponse.json({ error: 'Org não encontrado' }, { status: 404 })

  const { id } = await params
  const result = await snoozeNotification({
    orgId: ctx.membership.orgId,
    notificationId: id,
    option: body.option,
    actorUid: session.uid,
    tz: org.timezone,
  })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })

  return NextResponse.json({ ok: true })
}
