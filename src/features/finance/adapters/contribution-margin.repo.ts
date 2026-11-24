import 'server-only'

import {
  breakEven,
  partialContributionMargin,
  type BreakEven,
  type PartialContributionMargin,
} from '../core/cuts'
import { readOrgLedger, type LedgerWindow } from './ledger.repo'

export async function getPartialContributionMargin(
  window: LedgerWindow,
): Promise<PartialContributionMargin> {
  const ledger = await readOrgLedger(window)
  return partialContributionMargin(ledger)
}

export async function getBreakEven(window: LedgerWindow, unitId: string): Promise<BreakEven> {
  const ledger = await readOrgLedger(window)
  return breakEven(ledger.filter((entry) => entry.unitId === unitId))
}
