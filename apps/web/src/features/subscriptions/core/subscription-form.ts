// Pure subscription-form parsing/validation, extracted from the `'use server'`
// actions so it's importable + unit-testable (Functional Core / Imperative
// Shell). No I/O — the actions keep the Firestore loads + event emission.

import { type BillingCycle, BILLING_CYCLES } from '@/domain'
import { formString } from '@/shared/form-data'

export type CreatePayload = {
  customerId: string
  planId: string
  billingCycle: BillingCycle
  startAt: string
}

export type CreatePayloadWithDisplay = CreatePayload & { displayedPriceCents: number | null }

export function isBillingCycle(value: string): value is BillingCycle {
  return (BILLING_CYCLES as readonly string[]).includes(value)
}

export function parseCreateForm(formData: FormData): CreatePayloadWithDisplay | string {
  const customerId = formString(formData, 'customerId').trim()
  if (!customerId) return 'Cliente é obrigatório'

  const planId = formString(formData, 'planId').trim()
  if (!planId) return 'Plano é obrigatório'

  const billingCycleRaw = formString(formData, 'billingCycle')
  if (!isBillingCycle(billingCycleRaw)) return 'Ciclo de cobrança inválido'
  const billingCycle: BillingCycle = billingCycleRaw

  // Input do form é `date` (YYYY-MM-DD) — interpretamos como meia-noite UTC
  // do dia escolhido. Suficiente p/ V0; precisão por timezone do org pode
  // entrar depois sem mudar contrato (mesmo dia, hora diferente).
  const startInput = formString(formData, 'startAt').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startInput)) return 'Data de início inválida'
  const startAt = new Date(`${startInput}T00:00:00.000Z`).toISOString()

  // Preço do plano EXIBIDO ao operador ao montar o formulário (brief 0033
  // AC-09). Opcional — sem ele o commit cobra o preço vigente.
  const displayedRaw = formString(formData, 'displayedPriceCents').trim()
  let displayedPriceCents: number | null = null
  if (displayedRaw) {
    const n = Number(displayedRaw)
    if (!Number.isInteger(n) || n < 0) return 'Preço exibido inválido'
    displayedPriceCents = n
  }

  return { customerId, planId, billingCycle, startAt, displayedPriceCents }
}
