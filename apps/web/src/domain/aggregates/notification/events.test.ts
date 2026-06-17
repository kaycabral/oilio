import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'
import { NotificationEventSchema } from './events'

const decode = Schema.decodeUnknownSync(NotificationEventSchema)

// Kept as its own object so the negative cases can spread it without widening
// to `unknown`. Exercises every NotificationCreatedSchema field on decode.
const created = {
  _tag: 'notification.created',
  tenantId: 't1',
  unitId: 'u1',
  type: 'birthday',
  customerId: 'c1',
  appointmentId: null,
  subscriptionId: null,
  payload: { name: 'Maria' },
  source: 'cron',
  eventKey: 'birthday:c1:2026-06-09',
  validUntil: null,
}

// One minimal-but-valid event per `_tag`. Decoding each through the union
// exercises every variant's `_tag` literal and required fields — a mutated
// literal (e.g. → '') makes the matching sample fail to decode, killing it.
const SAMPLES: Record<string, unknown> = {
  'notification.created': created,
  'notification.dispatched': {
    _tag: 'notification.dispatched',
    channel: 'whatsapp',
    templateBody: 'Parabéns!',
  },
  'notification.read': { _tag: 'notification.read' },
  'notification.snoozed': {
    _tag: 'notification.snoozed',
    snoozedUntil: '2026-06-10T09:00:00.000Z',
  },
  'notification.expired': { _tag: 'notification.expired' },
}

// Every NotificationType literal — decoding a created event with each kills the
// corresponding Schema.Literal mutant in the union.
const NOTIFICATION_TYPES = [
  'birthday',
  'subscription_expiring_tomorrow',
  'subscription_expired',
  'subscription_overdue_followup',
  'order_stale',
  'cash_register_open',
  'new_customer',
  'payment_failure',
] as const

describe('NotificationEventSchema', () => {
  for (const [tag, sample] of Object.entries(SAMPLES)) {
    it(`decodes a valid ${tag} event`, () => {
      const decoded = decode(sample) as { _tag: string }
      expect(decoded._tag).toBe(tag)
    })
  }

  it('rejects an unknown _tag', () => {
    expect(() => decode({ _tag: 'notification.unknown' })).toThrow()
  })

  for (const type of NOTIFICATION_TYPES) {
    it(`accepts the ${type} notification type`, () => {
      const decoded = decode({ ...created, type })
      expect(decoded._tag === 'notification.created' ? decoded.type : undefined).toBe(type)
    })
  }

  it('rejects an unknown notification type', () => {
    expect(() => decode({ ...created, type: 'flying_saucer' })).toThrow()
  })

  it('accepts both notification sources and rejects an unknown one', () => {
    expect(() => decode({ ...created, source: 'cron' })).not.toThrow()
    expect(() => decode({ ...created, source: 'event' })).not.toThrow()
    expect(() => decode({ ...created, source: 'manual' })).toThrow()
  })

  it('accepts nullable fields as null or string', () => {
    expect(() =>
      decode({ ...created, customerId: 'c9', appointmentId: 'a1', validUntil: '2026-06-30' }),
    ).not.toThrow()
  })

  it('rejects a created event missing a required field', () => {
    const { eventKey: _omitted, ...withoutEventKey } = created
    expect(() => decode(withoutEventKey)).toThrow()
  })
})
