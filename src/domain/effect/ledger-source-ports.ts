import type { LedgerEntry } from '@/domain/types/ledger'
import { Context, type Effect } from 'effect'

export interface LedgerSourceWindow {
  readonly orgId: string
  readonly unitId: string
  readonly fromIso: string
  readonly toIso: string
}

export interface LedgerSourceOps {
  readonly fetchEntries: (
    window: LedgerSourceWindow,
  ) => Effect.Effect<readonly LedgerEntry[], unknown>
}

export class AcquirerLedgerPort extends Context.Service<AcquirerLedgerPort, LedgerSourceOps>()(
  'AcquirerLedgerPort',
) {}

export class FiscalLedgerPort extends Context.Service<FiscalLedgerPort, LedgerSourceOps>()(
  'FiscalLedgerPort',
) {}

export class BankLedgerPort extends Context.Service<BankLedgerPort, LedgerSourceOps>()(
  'BankLedgerPort',
) {}
