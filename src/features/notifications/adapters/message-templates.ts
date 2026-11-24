import {
  DEFAULT_NOTIFICATION_TEMPLATES,
  DISPATCHABLE_NOTIFICATION_TYPES,
  defaultTemplateBody,
  isDispatchableType,
  type DispatchableNotificationType,
  type MessageTemplate,
} from '@/domain'
import { getEventStorePool } from '@/shared/db/pg/pool'
import { readUnderRls } from '@/shared/db/pg/rls-read'

type MessageTemplateRow = {
  type: string
  body: string | null
  enabled: boolean
  last_actor_uid: string | null
  updated_at: string
}

function rowToTemplate(orgId: string, row: MessageTemplateRow): MessageTemplate | null {
  if (!isDispatchableType(row.type)) return null
  const type = row.type
  return {
    id: type,
    orgId,
    type,
    body: row.body ?? DEFAULT_NOTIFICATION_TEMPLATES[type],
    enabled: row.enabled,
    updatedAt: row.updated_at,
    lastActorUid: row.last_actor_uid,
  }
}

export async function getMessageTemplate(
  orgId: string,
  type: DispatchableNotificationType,
): Promise<MessageTemplate | null> {
  const rows = await readUnderRls<MessageTemplateRow>(orgId, (client) =>
    client
      .query<MessageTemplateRow>(
        'SELECT type, body, enabled, last_actor_uid, updated_at FROM message_templates WHERE org_id = $1 AND type = $2',
        [orgId, type],
      )
      .then((res) => res.rows),
  )
  const row = rows[0]
  return row ? rowToTemplate(orgId, row) : null
}

export async function resolveTemplateBody(
  orgId: string,
  type: DispatchableNotificationType,
): Promise<string> {
  const tpl = await getMessageTemplate(orgId, type)
  if (tpl && tpl.enabled && tpl.body.trim().length > 0) return tpl.body
  return defaultTemplateBody(type)
}

export async function listMessageTemplates(orgId: string): Promise<MessageTemplate[]> {
  const rows = await readUnderRls<MessageTemplateRow>(orgId, (client) =>
    client
      .query<MessageTemplateRow>(
        'SELECT type, body, enabled, last_actor_uid, updated_at FROM message_templates WHERE org_id = $1',
        [orgId],
      )
      .then((res) => res.rows),
  )
  const byType = new Map(
    rows.flatMap((r) => {
      const tpl = rowToTemplate(orgId, r)
      return tpl ? [[tpl.type, tpl] as const] : []
    }),
  )
  return DISPATCHABLE_NOTIFICATION_TYPES.map(
    (type) =>
      byType.get(type) ?? {
        id: type,
        orgId,
        type,
        body: DEFAULT_NOTIFICATION_TEMPLATES[type],
        enabled: true,
        updatedAt: '',
        lastActorUid: null,
      },
  )
}

export async function upsertMessageTemplate(input: {
  orgId: string
  type: DispatchableNotificationType
  body: string
  enabled: boolean
  lastActorUid: string
  updatedAt: string
}): Promise<void> {
  const { orgId, type, body, enabled, lastActorUid, updatedAt } = input
  const pool = getEventStorePool()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT set_config($1, $2, true)', ['app.current_org', orgId])
    await client.query(
      `INSERT INTO message_templates (org_id, type, body, enabled, last_actor_uid, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (org_id, type) DO UPDATE SET
         body = EXCLUDED.body,
         enabled = EXCLUDED.enabled,
         last_actor_uid = EXCLUDED.last_actor_uid,
         updated_at = EXCLUDED.updated_at`,
      [orgId, type, body, enabled, lastActorUid, updatedAt],
    )
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

export { isDispatchableType }
