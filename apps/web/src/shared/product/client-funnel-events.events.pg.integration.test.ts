import { closeEventStoreDb, getEventStorePool } from '@/shared/db/pg/pool'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { emitClientFunnelEvent } from './client-funnel-events'

let seq = 0
function uniqueOrg(): string {
  seq += 1
  return `org-funnel-${Date.now()}-${seq}`
}

type FunnelRow = {
  event: string
  org_id: string
  actor_id: string | null
  customer_id: string | null
  intent: string | null
  source: string | null
  medium: string | null
  campaign: string | null
  from_invite: string | null
  fields_filled: unknown
}

async function rowsFor(orgId: string): Promise<FunnelRow[]> {
  const res = await getEventStorePool().query<FunnelRow>(
    'SELECT * FROM client_funnel_events WHERE org_id = $1 ORDER BY id',
    [orgId],
  )
  return res.rows
}

describe('client_funnel_events transport (brief 0077 AC-12)', () => {
  beforeEach(async () => {
    await getEventStorePool().query(
      "DELETE FROM client_funnel_events WHERE org_id LIKE 'org-funnel-%'",
    )
  })

  afterAll(async () => {
    await closeEventStoreDb()
  })

  it('records client_invite_issued with actor + channel, no PII', async () => {
    const orgId = uniqueOrg()
    await emitClientFunnelEvent({
      event: 'client_invite_issued',
      orgId,
      actorId: 'recep-1',
      intent: 'signup',
      source: 'whatsapp',
      medium: 'invite',
    })
    const rows = await rowsFor(orgId)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      event: 'client_invite_issued',
      actor_id: 'recep-1',
      intent: 'signup',
      source: 'whatsapp',
      medium: 'invite',
      customer_id: null,
    })
  })

  it('records client_profile_completed with fields_filled as a JSON array of names', async () => {
    const orgId = uniqueOrg()
    await emitClientFunnelEvent({
      event: 'client_profile_completed',
      orgId,
      customerId: 'cust-1',
      fieldsFilled: ['whatsapp', 'birthDate'],
    })
    const rows = await rowsFor(orgId)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.customer_id).toBe('cust-1')
    expect(rows[0]?.fields_filled).toEqual(['whatsapp', 'birthDate'])
  })

  it('records client_signed_in with the from_invite flag', async () => {
    const orgId = uniqueOrg()
    await emitClientFunnelEvent({ event: 'client_signed_in', orgId, fromInvite: true })
    const rows = await rowsFor(orgId)
    expect(rows[0]?.from_invite).toBe('true')
  })

  it('records appointment_created with customer + attribution touch', async () => {
    const orgId = uniqueOrg()
    await emitClientFunnelEvent({
      event: 'appointment_created',
      orgId,
      customerId: 'cust-2',
      intent: 'booking',
      source: 'qr',
      medium: 'invite',
      campaign: 'verao',
    })
    const rows = await rowsFor(orgId)
    expect(rows[0]).toMatchObject({
      event: 'appointment_created',
      customer_id: 'cust-2',
      intent: 'booking',
      source: 'qr',
      campaign: 'verao',
    })
  })

  it('is best-effort: a DB CHECK violation (bad intent) is swallowed, not thrown', async () => {
    const orgId = uniqueOrg()
    await expect(
      getEventStorePool().query(
        `INSERT INTO client_funnel_events (event, org_id, intent, ts)
         VALUES ('client_signed_in', $1, 'nonsense', now())`,
        [orgId],
      ),
    ).rejects.toMatchObject({ code: '23514' })

    await emitClientFunnelEvent({ event: 'client_signed_in', orgId, fromInvite: false })
    const rows = await rowsFor(orgId)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.from_invite).toBe('false')
  })
})
