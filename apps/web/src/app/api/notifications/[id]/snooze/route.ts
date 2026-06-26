import { snoozeNotification } from '@/features/notifications/adapters/mark'
import { isSnoozeOption } from '@/features/notifications/core/snooze'
import { getSessionUser } from '@/shared/firebase/admin'
import { readJson } from '@/shared/http'
import { getActiveOrgContext } from '@/shared/org/membership'
import { getOrgRepresentativeTimezone } from '@/shared/org/org'
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

  // Timezone is the establishment's now (PRD Identidade v2 — moved Org→Unit);
  // snooze is org-scoped, so use a representative unit's tz.
  const tz = await getOrgRepresentativeTimezone(ctx.membership.orgId)

  const { id } = await params
  const result = await snoozeNotification({
    orgId: ctx.membership.orgId,
    notificationId: id,
    option: body.option,
    actorUid: session.uid,
    tz,
  })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })

  return NextResponse.json({ ok: true })
}
