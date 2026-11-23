import type { AppointmentStatus } from '../types/appointment'
import type { MembershipStatus } from '../types/enums'
import type { OrderStatus } from '../types/order'
import type { SubscriptionStatus } from '../types/subscription'

const ACTIVE_SUBSCRIPTION_STATUSES: ReadonlySet<SubscriptionStatus> = new Set([
  'active',
  'past_due',
])

export function isActiveSubscriptionStatus(status: SubscriptionStatus): boolean {
  return ACTIVE_SUBSCRIPTION_STATUSES.has(status)
}

export function isActiveOrderStatus(status: OrderStatus): boolean {
  return status === 'open'
}

export function isFutureScheduledAppointment(
  appointment: { status: AppointmentStatus; startAt: string },
  now: Date = new Date(),
): boolean {
  if (appointment.status !== 'scheduled') return false
  return new Date(appointment.startAt).getTime() > now.getTime()
}

export function isActiveMembershipStatus(status: MembershipStatus): boolean {
  return status !== 'revoked'
}
