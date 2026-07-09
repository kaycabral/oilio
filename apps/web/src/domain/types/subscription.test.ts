import { describe, expect, it } from 'vitest'

import { SUBSCRIPTION_STATUS_LABEL, SUBSCRIPTION_STATUSES } from './subscription'

describe('SUBSCRIPTION_STATUS_LABEL', () => {
  it('has a non-empty pt-BR label for every status (no raw enum leaks to a human)', () => {
    for (const status of SUBSCRIPTION_STATUSES) {
      const label = SUBSCRIPTION_STATUS_LABEL[status]
      expect(label, `missing label for status "${status}"`).toBeDefined()
      expect(label.trim().length).toBeGreaterThan(0)
      expect(label).not.toBe(status)
    }
  })

  it('maps the known statuses to their canonical pt-BR wording', () => {
    expect(SUBSCRIPTION_STATUS_LABEL.pending).toBe('Aguardando 1ª cobrança')
    expect(SUBSCRIPTION_STATUS_LABEL.active).toBe('Ativa')
    expect(SUBSCRIPTION_STATUS_LABEL.cancelled).toBe('Cancelada')
    expect(SUBSCRIPTION_STATUS_LABEL.cancelled_for_non_payment).toBe('Cancelada por inadimplência')
  })
})
