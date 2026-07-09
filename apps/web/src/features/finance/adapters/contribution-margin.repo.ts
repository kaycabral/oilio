import 'server-only'

import { partialContributionMargin, type PartialContributionMargin } from '../core/cuts'
import { readOrgLedger, type LedgerWindow } from './ledger.repo'

export async function getPartialContributionMargin(
  window: LedgerWindow,
): Promise<PartialContributionMargin> {
  const ledger = await readOrgLedger(window)
  return partialContributionMargin(ledger)
}
