import type { NotificationType } from '../aggregates/notification/types'
import { canManageOrg, type Role } from './enums'

export const MANAGER_ONLY_NOTIFICATION_TYPES = [
  'cash_register_open',
  'payment_failure',
] as const satisfies readonly NotificationType[]

function isManagerOnlyType(type: string): boolean {
  return (MANAGER_ONLY_NOTIFICATION_TYPES as readonly string[]).includes(type)
}

export function canRoleSeeNotificationType(role: Role, type: string): boolean {
  if (isManagerOnlyType(type)) return canManageOrg(role)
  return true
}

const ALL_NOTIFICATION_TYPES = [
  'birthday',
  'subscription_expiring_tomorrow',
  'subscription_expired',
  'subscription_overdue_followup',
  'order_stale',
  'cash_register_open',
  'new_customer',
  'payment_failure',
] as const satisfies readonly NotificationType[]

export function allowedNotificationTypesForRole(role: Role): NotificationType[] {
  return ALL_NOTIFICATION_TYPES.filter((t) => canRoleSeeNotificationType(role, t))
}
