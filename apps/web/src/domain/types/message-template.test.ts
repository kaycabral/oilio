import { describe, expect, it } from 'vitest'
import {
  DEFAULT_NOTIFICATION_TEMPLATES,
  DISPATCHABLE_NOTIFICATION_TYPES,
  defaultTemplateBody,
  isDispatchableType,
  renderNotificationTemplate,
} from './message-template'

describe('renderNotificationTemplate', () => {
  it('replaces known placeholders with vars', () => {
    const view = renderNotificationTemplate('Olá {cliente_nome}, seu {servico} sai por {valor}', {
      cliente_nome: 'Maria',
      servico: 'corte',
      valor: 'R$ 50',
    })
    expect(view).toBe('Olá Maria, seu corte sai por R$ 50')
  })

  it('missing/empty var → empty string (não deixa {undefined})', () => {
    const view = renderNotificationTemplate('Oi {cliente_nome}! {voucher_atual}', {
      cliente_nome: 'João',
    })
    expect(view).toBe('Oi João! ')
  })

  it('preview com SAMPLE_VARS renderiza voucher (AC-15)', () => {
    const body = DEFAULT_NOTIFICATION_TEMPLATES.subscription_expiring_tomorrow
    const view = renderNotificationTemplate(body, {
      cliente_nome: 'Maria',
      voucher_atual: 'hidratação',
    })
    expect(view).toContain('Maria')
    expect(view).toContain('hidratação')
    expect(view).not.toContain('{voucher_atual}')
  })

  it('placeholder desconhecido também vira vazio', () => {
    const view = renderNotificationTemplate('{inexistente} fim', {})
    expect(view).toBe(' fim')
  })
})

describe('isDispatchableType', () => {
  it('true para tipos de comunicação ao cliente', () => {
    expect(isDispatchableType('birthday')).toBe(true)
    expect(isDispatchableType('subscription_expired')).toBe(true)
    expect(isDispatchableType('new_customer')).toBe(true)
  })

  it('false para alertas operacionais internos', () => {
    expect(isDispatchableType('order_stale')).toBe(false)
    expect(isDispatchableType('cash_register_open')).toBe(false)
    expect(isDispatchableType('payment_failure')).toBe(false)
  })

  it('false para string arbitrária', () => {
    expect(isDispatchableType('whatever')).toBe(false)
  })
})

describe('defaults', () => {
  it('todo tipo dispatchable tem template default não-vazio', () => {
    for (const type of DISPATCHABLE_NOTIFICATION_TYPES) {
      expect(defaultTemplateBody(type).length).toBeGreaterThan(0)
    }
  })
})
