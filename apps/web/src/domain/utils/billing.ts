// Helpers puros pra cálculo de ciclos e janelas de cobrança.
//
// Invariante: tudo em ISO UTC. Display em tenant timezone é
// responsabilidade da camada de UI (ver utils/timezone).

import type { BillingCycle } from '../types/subscription-plan'

const CYCLE_TO_MONTHS: Record<BillingCycle, number> = {
  monthly: 1,
  quarterly: 3,
  semiannual: 6,
  annual: 12,
}

/**
 * Soma N meses ao instante UTC, preservando hora/minuto. Quando o dia
 * original não existe no mês alvo (ex.: 31 jan → 28 fev), clampa pro último
 * dia do mês alvo — comportamento padrão de cobrança recorrente.
 */
export function addMonthsUtc(iso: string, months: number): string {
  const d = new Date(iso)
  const year = d.getUTCFullYear()
  const month = d.getUTCMonth()
  const day = d.getUTCDate()
  const hours = d.getUTCHours()
  const minutes = d.getUTCMinutes()
  const seconds = d.getUTCSeconds()
  const ms = d.getUTCMilliseconds()

  const targetMonth = month + months
  const targetYear = year + Math.floor(targetMonth / 12)
  const normalizedMonth = ((targetMonth % 12) + 12) % 12

  // Último dia do mês alvo, p/ clampar.
  const lastDay = new Date(Date.UTC(targetYear, normalizedMonth + 1, 0)).getUTCDate()
  const targetDay = Math.min(day, lastDay)

  return new Date(
    Date.UTC(targetYear, normalizedMonth, targetDay, hours, minutes, seconds, ms),
  ).toISOString()
}

/**
 * Período do ciclo a partir do start. Retorna [startAt, endAt) — endAt
 * é exclusivo. Exemplo: monthly a partir de 2026-01-15 → 2026-02-15.
 */
export function computeBillingPeriod(
  startIso: string,
  cycle: BillingCycle,
): { startAt: string; endAt: string } {
  return {
    startAt: startIso,
    endAt: addMonthsUtc(startIso, CYCLE_TO_MONTHS[cycle]),
  }
}

/**
 * Próxima data de cobrança = início do próximo ciclo, idêntico a endAt
 * do período atual. Separado por clareza — `nextChargeDate` na UI é o
 * "quando vou ser cobrado" do dono.
 */
export function computeNextChargeDate(periodEndAtIso: string): string {
  return periodEndAtIso
}

/**
 * Verifica se o consumo do período já estourou o limite contratado.
 * Plano ilimitado nunca atinge limite. Retorna true quando consumo ≥ limite.
 */
export function isUsageLimitReached(
  consumed: number,
  limit: { kind: 'unlimited' } | { kind: 'count'; quantity: number },
): boolean {
  if (limit.kind === 'unlimited') return false
  return consumed >= limit.quantity
}

/**
 * Saldo restante no ciclo. Plano ilimitado → null (sem saldo a exibir).
 */
export function remainingUsage(
  consumed: number,
  limit: { kind: 'unlimited' } | { kind: 'count'; quantity: number },
): number | null {
  if (limit.kind === 'unlimited') return null
  return Math.max(0, limit.quantity - consumed)
}
