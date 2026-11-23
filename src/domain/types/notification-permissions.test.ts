import { describe, expect, it } from 'vitest'
import {
  MANAGER_ONLY_NOTIFICATION_TYPES,
  allowedNotificationTypesForRole,
  canRoleSeeNotificationType,
} from './notification-permissions'

describe('canRoleSeeNotificationType', () => {
  it('receptionist NÃO vê tipos financeiros/admin (AC-18)', () => {
    expect(canRoleSeeNotificationType('receptionist', 'cash_register_open')).toBe(false)
    expect(canRoleSeeNotificationType('receptionist', 'payment_failure')).toBe(false)
  })

  it('receptionist vê comunicação operacional (AC-18)', () => {
    expect(canRoleSeeNotificationType('receptionist', 'birthday')).toBe(true)
    expect(canRoleSeeNotificationType('receptionist', 'subscription_expired')).toBe(true)
    expect(canRoleSeeNotificationType('receptionist', 'new_customer')).toBe(true)
    expect(canRoleSeeNotificationType('receptionist', 'order_stale')).toBe(true)
  })

  it('manager e owner veem tudo (AC-19)', () => {
    for (const type of MANAGER_ONLY_NOTIFICATION_TYPES) {
      expect(canRoleSeeNotificationType('manager', type)).toBe(true)
      expect(canRoleSeeNotificationType('owner', type)).toBe(true)
    }
  })

  it('memberOperation segue restrição (não-manager)', () => {
    expect(canRoleSeeNotificationType('member_operator', 'cash_register_open')).toBe(false)
    expect(canRoleSeeNotificationType('member_operator', 'birthday')).toBe(true)
  })
})

describe('allowedNotificationTypesForRole', () => {
  it('receptionist exclui os manager-only', () => {
    const allowed = allowedNotificationTypesForRole('receptionist')
    expect(allowed).not.toContain('cash_register_open')
    expect(allowed).not.toContain('payment_failure')
    expect(allowed).toContain('birthday')
    expect(allowed).toContain('order_stale')
  })

  it('manager inclui todos', () => {
    const allowed = allowedNotificationTypesForRole('manager')
    expect(allowed).toContain('cash_register_open')
    expect(allowed).toContain('payment_failure')
    expect(allowed.length).toBe(8)
  })
})
