import { type BillingCycle, BILLING_CYCLES, fromOrgTime } from '@/domain'
import { formString } from '@/shared/form-data'

export type CreatePayload = {
  customerId: string
  planId: string
  billingCycle: BillingCycle
  startDate: string
}

export type CreatePayloadWithDisplay = CreatePayload & { displayedPriceCents: number | null }

export function isBillingCycle(value: string): value is BillingCycle {
  return (BILLING_CYCLES as readonly string[]).includes(value)
}

export function resolveVigenciaStart(startDate: string, timezone: string): string {
  return fromOrgTime({ date: startDate, hour: 0, minute: 0 }, timezone)
}

export function parseCreateForm(formData: FormData): CreatePayloadWithDisplay | string {
  const customerId = formString(formData, 'customerId').trim()
  if (!customerId) return 'Cliente é obrigatório'

  const planId = formString(formData, 'planId').trim()
  if (!planId) return 'Plano é obrigatório'

  const billingCycleRaw = formString(formData, 'billingCycle')
  if (!isBillingCycle(billingCycleRaw)) return 'Ciclo de cobrança inválido'
  const billingCycle: BillingCycle = billingCycleRaw

  const startDate = formString(formData, 'startAt').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return 'Data de início inválida'

  const displayedRaw = formString(formData, 'displayedPriceCents').trim()
  let displayedPriceCents: number | null = null
  if (displayedRaw) {
    const n = Number(displayedRaw)
    if (!Number.isInteger(n) || n < 0) return 'Preço exibido inválido'
    displayedPriceCents = n
  }

  return { customerId, planId, billingCycle, startDate, displayedPriceCents }
}
