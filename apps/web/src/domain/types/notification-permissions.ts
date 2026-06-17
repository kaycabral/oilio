// Permissões de visibilidade de notificação por role (brief 0018 Grupo E).
// Receptionist (Aurora) vê comunicação operacional; tipos financeiros/
// administrativos (caixa, falha de pagamento) só Manager+ (cliente-zero).

import type { NotificationType } from '../aggregates/notification/types'
import { canManageTenant, type Role } from './enums'

// Tipos que só Manager/Owner enxergam — financeiro/administrativo.
export const MANAGER_ONLY_NOTIFICATION_TYPES = [
  'cash_register_open',
  'payment_failure',
] as const satisfies readonly NotificationType[]

function isManagerOnlyType(type: string): boolean {
  return (MANAGER_ONLY_NOTIFICATION_TYPES as readonly string[]).includes(type)
}

// AC-18/19: receptionist NÃO vê tipos manager-only; manager+ vê tudo.
export function canRoleSeeNotificationType(role: Role, type: string): boolean {
  if (isManagerOnlyType(type)) return canManageTenant(role)
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

// Lista de tipos visíveis pra um role — usada como filtro na query.
export function allowedNotificationTypesForRole(role: Role): NotificationType[] {
  return ALL_NOTIFICATION_TYPES.filter((t) => canRoleSeeNotificationType(role, t))
}
