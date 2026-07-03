// Postgres integration test — #957, brief 0018 Grupo C (re-substrated to
// Postgres by the cutover, #1202).
//
// Runs against the ephemeral `oilio` Postgres (OILIO_DATABASE_URL); the
// event-store globalSetup applies the migrations.
//
// Cobre:
// - AC-12: MessageTemplate config-doc — read custom vs default fallback. The
//   `message_templates` table is an org-scoped CONFIG table (CRUD-ish, written
//   via `upsertMessageTemplate`, read under RLS). Seed via `upsertMessageTemplate`
//   — the same upsert the settings server action runs.
// - AC-14: dispatchNotificationWhatsapp renderiza + retorna link + grava
//   notification.dispatched com snapshot (channel + body NÃO-renderizado). The
//   notification is created through the event store; the customer's PII (name +
//   mobile) lives on the global `users` row (materialized at read time).

import { DEFAULT_NOTIFICATION_TEMPLATES } from '@/domain'
import { NotificationConfig } from '@/domain/aggregates'
import { aggregateRef, appendEvent } from '@/domain/effect'
import { PostgresPersistenceLayer } from '@/shared/db/pg/effect/postgres-layer'
import { closeEventStoreDb, getEventStorePool } from '@/shared/db/pg/pool'
import { putUser } from '@/shared/db/pg/users-store'
import { buildUser } from '@/shared/fixtures/domain-builders'
import { Effect } from 'effect'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { dispatchNotificationWhatsapp } from './dispatch'
import { getMessageTemplate, resolveTemplateBody, upsertMessageTemplate } from './message-templates'

function uniqueOrgId(label: string): string {
  return `t-${label}-${Math.random().toString(36).slice(2, 8)}`
}

async function seedOrg(orgId: string): Promise<void> {
  await getEventStorePool().query(
    `INSERT INTO orgs (org_id, id, last_event_version, name, slug, vertical, owner_user_id, branding, created_at, updated_at)
     VALUES ($1,$1,1,'Org','slug-'||$1,'barbershop','owner','{}'::jsonb,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`,
    [orgId],
  )
}

describe('MessageTemplate config-doc (AC-12) — Postgres', () => {
  beforeEach(async () => {
    await getEventStorePool().query('TRUNCATE message_templates, orgs CASCADE')
  })

  afterAll(async () => {
    await closeEventStoreDb()
  })

  it('getMessageTemplate returns null when never customized', async () => {
    const orgId = uniqueOrgId('tpl-absent')
    await seedOrg(orgId)
    const tpl = await getMessageTemplate(orgId, 'birthday')
    expect(tpl).toBeNull()
  })

  it('reads custom body after write', async () => {
    const orgId = uniqueOrgId('tpl-custom')
    await seedOrg(orgId)
    await upsertMessageTemplate({
      orgId,
      type: 'birthday',
      body: 'Parabéns {cliente_nome}! 🎂',
      enabled: true,
      lastActorUid: 'owner-1',
      updatedAt: '2026-06-01T10:00:00Z',
    })

    const tpl = await getMessageTemplate(orgId, 'birthday')
    expect(tpl?.body).toBe('Parabéns {cliente_nome}! 🎂')
    expect(tpl?.enabled).toBe(true)
  })

  it('resolveTemplateBody: custom when enabled, default when disabled', async () => {
    const orgId = uniqueOrgId('tpl-resolve')
    await seedOrg(orgId)

    await upsertMessageTemplate({
      orgId,
      type: 'new_customer',
      body: 'Custom welcome {cliente_nome}',
      enabled: true,
      lastActorUid: 'owner-1',
      updatedAt: '2026-06-01T10:00:00Z',
    })
    expect(await resolveTemplateBody(orgId, 'new_customer')).toBe('Custom welcome {cliente_nome}')

    await upsertMessageTemplate({
      orgId,
      type: 'new_customer',
      body: 'Custom welcome {cliente_nome}',
      enabled: false,
      lastActorUid: 'owner-1',
      updatedAt: '2026-06-01T11:00:00Z',
    })
    expect(await resolveTemplateBody(orgId, 'new_customer')).toBe(
      DEFAULT_NOTIFICATION_TEMPLATES.new_customer,
    )
  })
})

describe('dispatchNotificationWhatsapp (AC-14) — Postgres', () => {
  beforeEach(async () => {
    await getEventStorePool().query(
      'TRUNCATE events, projections, notifications, customers, users, orgs CASCADE',
    )
  })

  afterAll(async () => {
    await closeEventStoreDb()
  })

  // Seeds the customer's global `users` row (PII: name + mobile), the per-org
  // `customers` shadow (id-ref only), and the notification through the event
  // store — the live shape `dispatchNotificationWhatsapp` reads.
  async function seedCustomerAndNotification(orgId: string): Promise<{ notifId: string }> {
    const uid = `u-${Math.random().toString(36).slice(2, 8)}`
    const customerId = `c-${Math.random().toString(36).slice(2, 8)}`
    const notifId = `n-${Math.random().toString(36).slice(2, 8)}`

    await putUser(
      buildUser(uid, '2026-06-01T10:00:00Z', { displayName: 'Maria', mobile: '5511999998888' }),
    )
    await getEventStorePool().query(
      `INSERT INTO customers (org_id, id, last_event_version, user_id, archived_at, deactivated_at, created_at, updated_at)
       VALUES ($1,$2,1,$3,NULL,NULL,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`,
      [orgId, customerId, uid],
    )
    await Effect.runPromise(
      appendEvent(NotificationConfig, aggregateRef(NotificationConfig, orgId, notifId), {
        _tag: 'notification.created',
        actorId: 'test',
        payload: {
          orgId,
          unitId: 'u1',
          type: 'birthday',
          customerId,
          appointmentId: null,
          subscriptionId: null,
          payload: {},
          source: 'cron',
          eventKey: `birthday-${notifId}`,
          validUntil: null,
        },
      }).pipe(Effect.provide(PostgresPersistenceLayer)),
    )
    return { notifId }
  }

  it('returns wa.me link + grava snapshot channel + body no dispatched', async () => {
    const orgId = uniqueOrgId('dispatch')
    await seedOrg(orgId)
    const { notifId } = await seedCustomerAndNotification(orgId)

    const result = await dispatchNotificationWhatsapp(orgId, notifId, 'owner-1')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.link).toContain('https://wa.me/5511999998888')
    expect(result.link).toContain('Maria')

    const res = await getEventStorePool().query<{
      dispatched_at: string | null
      dispatch: { dispatchedChannel: string | null; dispatchedBody: string | null } | null
    }>('SELECT dispatched_at, dispatch FROM notifications WHERE org_id = $1 AND id = $2', [
      orgId,
      notifId,
    ])
    const row = res.rows[0]
    expect(row?.dispatched_at).toBeTruthy()
    expect(row?.dispatch?.dispatchedChannel).toBe('wa_link')
    // Snapshot é o body NÃO-renderizado (a receita), não o texto final.
    expect(row?.dispatch?.dispatchedBody).toBe(DEFAULT_NOTIFICATION_TEMPLATES.birthday)
    expect(row?.dispatch?.dispatchedBody).toContain('{cliente_nome}')
  })

  it('rejects non-dispatchable type', async () => {
    const orgId = uniqueOrgId('dispatch-reject')
    await seedOrg(orgId)
    const notifId = `n-${Math.random().toString(36).slice(2, 8)}`
    await Effect.runPromise(
      appendEvent(NotificationConfig, aggregateRef(NotificationConfig, orgId, notifId), {
        _tag: 'notification.created',
        actorId: 'test',
        payload: {
          orgId,
          unitId: 'u1',
          type: 'cash_register_open',
          customerId: null,
          appointmentId: null,
          subscriptionId: null,
          payload: {},
          source: 'cron',
          eventKey: `cash-${notifId}`,
          validUntil: null,
        },
      }).pipe(Effect.provide(PostgresPersistenceLayer)),
    )

    const result = await dispatchNotificationWhatsapp(orgId, notifId, 'owner-1')
    expect(result.ok).toBe(false)
  })
})
