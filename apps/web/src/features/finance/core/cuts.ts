import type { LedgerEntry } from '@/domain'

// Cortes derivados do Razão (brief 0091, AC-03). Funções PURAS que consomem só
// `LedgerEntry[]` — provam que qualquer corte financeiro deriva de uma fonte
// única (o Razão), sem somar `orders`/`commissions`/`charges` como fontes
// paralelas ad-hoc. Novos cortes (DRE-MC completa, lucro, ponto de equilíbrio)
// nascem aqui, sobre a mesma entrada, conforme B/C/E populam mais naturezas.

// Sinal do entry no resultado: `in` soma, `out` subtrai. Um estorno de receita
// é `revenue` + `out`, então subtrai — a soma respeita a direção, mantendo o
// Razão aditivo (nunca reescreve entry passado).
function signed(entry: LedgerEntry): number {
  // `amountCents` is a branded `Money`; read it as a plain number for arithmetic.
  const cents: number = entry.amountCents
  return entry.direction === 'in' ? cents : -cents
}

// Margem de contribuição PARCIAL: receita − custos variáveis conhecidos. Na
// fundação o único variável é a comissão (CSP); impostos/MDR/CMV entram com as
// features C/E e caem no mesmo corte sem mudança aqui — por isso "parcial", e o
// rótulo é honesto sobre a cegueira de custo (Visão § Princípio 5).
export type PartialContributionMargin = {
  revenueCents: number
  variableCostCents: number
  // revenue − variáveis. Pode ser negativo (custo variável > receita no período).
  marginCents: number
  // true enquanto faltam custos variáveis além da comissão (imposto/MDR/CMV) —
  // o consumidor rotula "parcial (após comissão)". Vira false quando C/E entram.
  partial: boolean
}

const KNOWN_VARIABLE_NATURES = new Set<LedgerEntry['nature']>(['csp', 'cmv', 'tax_on_sale'])

// Deriva a MC parcial de um Razão (uma janela/escopo já lido). Lê SÓ o
// `LedgerEntry[]` — nenhuma outra fonte. `partial` é true enquanto o único
// variável presente for a comissão (CSP), sinalizando custo incompleto.
export function partialContributionMargin(
  ledger: readonly LedgerEntry[],
): PartialContributionMargin {
  let revenueCents = 0
  let variableCostCents = 0
  let hasNonCommissionVariable = false

  for (const entry of ledger) {
    if (entry.nature === 'revenue') {
      revenueCents += signed(entry)
      continue
    }
    if (entry.behavior === 'variable' && KNOWN_VARIABLE_NATURES.has(entry.nature)) {
      // Custo entra como valor absoluto (direction já é `out`); somamos o
      // módulo e subtraímos da receita no final. `amountCents` é `Money` branded
      // — lido como number pra soma.
      const cents: number = entry.amountCents
      variableCostCents += cents
      if (entry.nature !== 'csp') hasNonCommissionVariable = true
    }
  }

  return {
    revenueCents,
    variableCostCents,
    marginCents: revenueCents - variableCostCents,
    // Parcial enquanto não há variável além da comissão. Se algum imposto/MDR/
    // CMV já foi capturado (C/E), o custo variável está mais completo.
    partial: !hasNonCommissionVariable,
  }
}
