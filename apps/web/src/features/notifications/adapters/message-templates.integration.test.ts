// Integration test — #957, brief 0018 Grupo C.
//
// Runs against the Firebase emulator (firestore on 127.0.0.1:8080):
//   pnpm --filter @oilio/web db:start
//   pnpm --filter @oilio/web test:integration
//
// Cobre:
// - AC-12: MessageTemplate config-doc — read custom vs default fallback
// - AC-14: dispatchNotificationWhatsapp renderiza + retorna link + grava
//   notification.dispatched com snapshot (channel + body NÃO-renderizado)

import { DEFAULT_NOTIFICATION_TEMPLATES } from '@/domain'
import { buildStoredCustomer, buildUser } from '@/shared/fixtures/domain-builders'
import { getApps, initializeApp, type App } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'
import { beforeAll, describe, expect, it } from 'vitest'
import { dispatchNotificationWhatsapp } from './dispatch'
import { getMessageTemplate, resolveTemplateBody } from './message-templates'

const PROJECT_ID = 'scheduling-local'

let app: App
let db: Firestore

beforeAll(() => {
  app = getApps()[0] ?? initializeApp({ projectId: PROJECT_ID })
  db = getFirestore(app)
})

function uniqueTenantId(label: string) {
  return `t-${label}-${Math.random().toString(36).slice(2, 8)}`
}

describe('MessageTemplate config-doc (AC-12)', () => {
  it('getMessageTemplate returns null when never customized', async () => {
    const tenantId = uniqueTenantId('tpl-absent')
    const tpl = await getMessageTemplate(tenantId, 'birthday')
    expect(tpl).toBeNull()
  })

  it('reads custom body after write', async () => {
    const tenantId = uniqueTenantId('tpl-custom')
    await db
      .collection('tenants')
      .doc(tenantId)
      .collection('message_templates')
      .doc('birthday')
      .set({
        id: 'birthday',
        tenantId,
        type: 'birthday',
        body: 'Parabéns {cliente_nome}! 🎂',
        enabled: true,
        updatedAt: '2026-06-01T10:00:00Z',
        lastActorUid: 'owner-1',
      })

    const tpl = await getMessageTemplate(tenantId, 'birthday')
    expect(tpl?.body).toBe('Parabéns {cliente_nome}! 🎂')
    expect(tpl?.enabled).toBe(true)
  })

  it('resolveTemplateBody: custom when enabled, default when disabled', async () => {
    const tenantId = uniqueTenantId('tpl-resolve')
    const ref = db
      .collection('tenants')
      .doc(tenantId)
      .collection('message_templates')
      .doc('new_customer')

    await ref.set({
      id: 'new_customer',
      tenantId,
      type: 'new_customer',
      body: 'Custom welcome {cliente_nome}',
      enabled: true,
      updatedAt: '2026-06-01T10:00:00Z',
      lastActorUid: 'owner-1',
    })
    expect(await resolveTemplateBody(tenantId, 'new_customer')).toBe(
      'Custom welcome {cliente_nome}',
    )

    await ref.update({ enabled: false })
    expect(await resolveTemplateBody(tenantId, 'new_customer')).toBe(
      DEFAULT_NOTIFICATION_TEMPLATES.new_customer,
    )
  })
})

describe('dispatchNotificationWhatsapp (AC-14)', () => {
  async function seedCustomerAndNotification(tenantId: string) {
    const uid = `u-${Math.random().toString(36).slice(2, 8)}`
    const customerId = `c-${Math.random().toString(36).slice(2, 8)}`
    const notifId = `n-${Math.random().toString(36).slice(2, 8)}`

    await db
      .collection('users')
      .doc(uid)
      .set(
        buildUser(uid, '2026-06-01T10:00:00Z', { displayName: 'Maria', whatsapp: '11999998888' }),
      )
    await db
      .collection('tenants')
      .doc(tenantId)
      .collection('customers')
      .doc(customerId)
      .set(buildStoredCustomer(customerId, tenantId, uid, '2026-06-01T10:00:00Z'))
    await db
      .collection('tenants')
      .doc(tenantId)
      .collection('notifications')
      .doc(notifId)
      .set({
        id: notifId,
        tenantId,
        unitId: 'u1',
        type: 'birthday',
        customerId,
        appointmentId: null,
        subscriptionId: null,
        payload: {},
        source: 'cron',
        eventKey: `birthday-${notifId}`,
        createdAt: '2026-06-01T10:00:00Z',
        readAt: null,
        dispatchedAt: null,
        dispatchedChannel: null,
        dispatchedBody: null,
        validUntil: null,
        snoozedUntil: null,
        _version: 1,
      })
    return { notifId, customerId }
  }

  it('returns wa.me link + grava snapshot channel + body no dispatched', async () => {
    const tenantId = uniqueTenantId('dispatch')
    const { notifId } = await seedCustomerAndNotification(tenantId)

    const result = await dispatchNotificationWhatsapp(tenantId, notifId, 'owner-1')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.link).toContain('https://wa.me/5511999998888')
    expect(result.link).toContain('Maria')

    const snap = await db
      .collection('tenants')
      .doc(tenantId)
      .collection('notifications')
      .doc(notifId)
      .get()
    const notif = snap.data() ?? {}
    expect(notif.dispatchedAt).toBeTruthy()
    expect(notif.dispatchedChannel).toBe('wa_link')
    // Snapshot é o body NÃO-renderizado (a receita), não o texto final.
    expect(notif.dispatchedBody).toBe(DEFAULT_NOTIFICATION_TEMPLATES.birthday)
    expect(notif.dispatchedBody).toContain('{cliente_nome}')
  })

  it('rejects non-dispatchable type', async () => {
    const tenantId = uniqueTenantId('dispatch-reject')
    const notifId = `n-${Math.random().toString(36).slice(2, 8)}`
    await db
      .collection('tenants')
      .doc(tenantId)
      .collection('notifications')
      .doc(notifId)
      .set({ id: notifId, tenantId, type: 'cash_register_open', customerId: null, payload: {} })

    const result = await dispatchNotificationWhatsapp(tenantId, notifId, 'owner-1')
    expect(result.ok).toBe(false)
  })
})
