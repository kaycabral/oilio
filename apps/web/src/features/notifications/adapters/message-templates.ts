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

// Message templates are an org-scoped CONFIG table (not a domain aggregate, not
// event-sourced) — written directly via upsert, read under RLS. Post-cutover
// (brief 0062) this lives in the Postgres `message_templates` table; the
// Firestore `orgs/{orgId}/message_templates/{type}` doc is gone.

type MessageTemplateRow = {
  type: string
  body: string | null
  enabled: boolean
  last_actor_uid: string | null
  updated_at: string
}

function aggregatePath(orgId: string, type: string): string {
  return `orgs/${orgId}/message_templates/${type}`
}

// Maps a row to the domain `MessageTemplate`, narrowing `type` through the
// dispatchable guard (the DB CHECK guarantees it, but the guard keeps the type
// honest without an assertion). Returns null for a row whose type is not
// dispatchable (unreachable in practice — defends against a future schema drift).
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

// Lê o template config-doc de um tipo. null quando o owner nunca customizou.
export async function getMessageTemplate(
  orgId: string,
  type: DispatchableNotificationType,
): Promise<MessageTemplate | null> {
  const rows = await readUnderRls<MessageTemplateRow>(orgId, (client) =>
    client
      .query<MessageTemplateRow>(
        'SELECT type, body, enabled, last_actor_uid, updated_at FROM message_templates WHERE aggregate_path = $1',
        [aggregatePath(orgId, type)],
      )
      .then((res) => res.rows),
  )
  const row = rows[0]
  return row ? rowToTemplate(orgId, row) : null
}

// Body efetivo pra render: custom do owner se existe + enabled, senão default.
export async function resolveTemplateBody(
  orgId: string,
  type: DispatchableNotificationType,
): Promise<string> {
  const tpl = await getMessageTemplate(orgId, type)
  if (tpl && tpl.enabled && tpl.body.trim().length > 0) return tpl.body
  return defaultTemplateBody(type)
}

// Lista todos os templates dispatchable do org (custom ou default) — usado
// pela página /settings/notifications. Uma leitura por org (não N point-reads).
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

// Upsert do template customizado (chamado pela server action de settings). Org-
// scoped: o write roda sob RLS (GUC setado por transação) — a policy WITH CHECK
// recusa um org_id que não bate com o contexto.
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
      `INSERT INTO message_templates (aggregate_path, org_id, type, body, enabled, last_actor_uid, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (aggregate_path) DO UPDATE SET
         body = EXCLUDED.body,
         enabled = EXCLUDED.enabled,
         last_actor_uid = EXCLUDED.last_actor_uid,
         updated_at = EXCLUDED.updated_at`,
      [aggregatePath(orgId, type), orgId, type, body, enabled, lastActorUid, updatedAt],
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
