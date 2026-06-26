import { describe, expect, it } from 'vitest'
import { liquidationStatusOf } from './commission'

describe('liquidationStatusOf', () => {
  it('default pendente quando ausente', () => {
    expect(liquidationStatusOf({})).toBe('pendente')
  })

  it('preserva pendente e pago', () => {
    expect(liquidationStatusOf({ liquidationStatus: 'pendente' })).toBe('pendente')
    expect(liquidationStatusOf({ liquidationStatus: 'pago' })).toBe('pago')
  })

  // Migração (brief 0022 #998): nenhum estado legado de split foi liquidado via
  // gateway, então todos mapeiam para `pendente` na leitura.
  it.each(['auto_split', 'simulated_split', 'manual_only', 'manual_pending', 'manual_done'])(
    'mapeia estado legado %s para pendente',
    (legacy) => {
      expect(liquidationStatusOf({ liquidationStatus: legacy })).toBe('pendente')
    },
  )
})
