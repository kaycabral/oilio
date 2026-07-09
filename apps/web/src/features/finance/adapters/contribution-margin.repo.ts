import 'server-only'

import { partialContributionMargin, type PartialContributionMargin } from '../core/cuts'
import { readOrgLedger, type LedgerWindow } from './ledger.repo'

// Reconecta o corte (core/cuts.ts) à fonte única do Razão (Onda 2, brief 0091
// AC-03). A MC parcial é derivada do `LedgerEntry[]` lido do EVENT STREAM — nunca
// de `orders`/`commissions`/`charges` somados em paralelo. Este é o único ponto
// que costura leitura (adapter) + corte puro (core): a features/app chama daqui,
// então nenhum consumidor toca `readOrgLedger` e `partialContributionMargin`
// separados (a ordem — ler o Razão, depois cortar — fica encapsulada).
export async function getPartialContributionMargin(
  window: LedgerWindow,
): Promise<PartialContributionMargin> {
  const ledger = await readOrgLedger(window)
  return partialContributionMargin(ledger)
}
