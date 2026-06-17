import type { EventMeta } from '@/domain/effect/event-store'
import type { TenantEvent } from './events'
import type { TenantState } from './types'

export function applyTenantEvent(
  state: TenantState,
  event: TenantEvent,
  meta: EventMeta,
): TenantState {
  const base = { ...state, _version: meta.version, updatedAt: meta.timestamp }

  switch (event._tag) {
    case 'tenant.created':
      return { ...base, ...event.data, createdAt: meta.timestamp, updatedAt: meta.timestamp }
    case 'tenant.updated':
      return { ...base, ...event.changes, updatedAt: meta.timestamp }
    case 'tenant.self_booking_published':
      return { ...base, selfBookingPublished: true, selfBookingPublishedAt: meta.timestamp }
    case 'tenant.self_booking_unpublished':
      return { ...base, selfBookingPublished: false }
    case 'tenant.deleted':
      return base
  }
}
