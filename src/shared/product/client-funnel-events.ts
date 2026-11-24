import type { Attribution } from '@/domain'
import { getEventStorePool } from '@/shared/db/pg/pool'
import { logger } from '@cbrl/log'
import 'server-only'

export type ClientFunnelEventName =
  | 'client_invite_issued'
  | 'client_invite_opened'
  | 'client_signed_in'
  | 'client_profile_completed'
  | 'appointment_created'

type Channel = {
  readonly intent?: 'signup' | 'booking' | null
  readonly source?: string | null
  readonly medium?: string | null
  readonly campaign?: string | null
}

export type ClientInviteIssuedPayload = Channel & {
  readonly orgId: string
  readonly unitId?: string | null
  readonly actorId: string | null
}

export type ClientInviteOpenedPayload = Channel & {
  readonly orgId: string
}

export type ClientSignedInPayload = {
  readonly orgId: string
  readonly fromInvite: boolean
}

export type ClientProfileCompletedPayload = {
  readonly orgId: string
  readonly customerId: string | null
  readonly fieldsFilled: readonly string[]
}

export type AppointmentCreatedPayload = Channel & {
  readonly orgId: string
  readonly customerId: string
}

type ClientFunnelEventPayload =
  | ({ event: 'client_invite_issued' } & ClientInviteIssuedPayload)
  | ({ event: 'client_invite_opened' } & ClientInviteOpenedPayload)
  | ({ event: 'client_signed_in' } & ClientSignedInPayload)
  | ({ event: 'client_profile_completed' } & ClientProfileCompletedPayload)
  | ({ event: 'appointment_created' } & AppointmentCreatedPayload)

type FunnelColumns = {
  orgId: string
  unitId: string | null
  actorId: string | null
  customerId: string | null
  intent: string | null
  source: string | null
  medium: string | null
  campaign: string | null
  fromInvite: string | null
  fieldsFilled: readonly string[] | null
}

function columnsFor(event: ClientFunnelEventPayload): FunnelColumns {
  const base: FunnelColumns = {
    orgId: event.orgId,
    unitId: null,
    actorId: null,
    customerId: null,
    intent: null,
    source: null,
    medium: null,
    campaign: null,
    fromInvite: null,
    fieldsFilled: null,
  }
  switch (event.event) {
    case 'client_invite_issued':
      return {
        ...base,
        unitId: event.unitId ?? null,
        actorId: event.actorId,
        intent: event.intent ?? null,
        source: event.source ?? null,
        medium: event.medium ?? null,
        campaign: event.campaign ?? null,
      }
    case 'client_invite_opened':
      return {
        ...base,
        intent: event.intent ?? null,
        source: event.source ?? null,
        medium: event.medium ?? null,
        campaign: event.campaign ?? null,
      }
    case 'client_signed_in':
      return { ...base, fromInvite: event.fromInvite ? 'true' : 'false' }
    case 'client_profile_completed':
      return { ...base, customerId: event.customerId, fieldsFilled: event.fieldsFilled }
    case 'appointment_created':
      return {
        ...base,
        customerId: event.customerId,
        intent: event.intent ?? null,
        source: event.source ?? null,
        medium: event.medium ?? null,
        campaign: event.campaign ?? null,
      }
  }
}

export function channelOf(attribution: Attribution): Required<Channel> {
  return {
    intent: attribution.intent,
    source: attribution.source,
    medium: attribution.medium,
    campaign: attribution.campaign,
  }
}

export async function emitClientFunnelEvent(event: ClientFunnelEventPayload): Promise<void> {
  const c = columnsFor(event)
  try {
    await getEventStorePool().query(
      `INSERT INTO client_funnel_events
         (event, org_id, unit_id, actor_id, customer_id, intent, source, medium,
          campaign, from_invite, fields_filled, ts)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        event.event,
        c.orgId,
        c.unitId,
        c.actorId,
        c.customerId,
        c.intent,
        c.source,
        c.medium,
        c.campaign,
        c.fromInvite,
        c.fieldsFilled === null ? null : JSON.stringify(c.fieldsFilled),
        new Date().toISOString(),
      ],
    )
  } catch (err) {
    logger.error('failed to record client funnel event', {
      scope: 'emitClientFunnelEvent',
      event: event.event,
      err,
    })
  }
}
