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

export class AcquirerLedgerPort extends Context.Tag('AcquirerLedgerPort')<
  AcquirerLedgerPort,
  LedgerSourceOps
>() {}

export class FiscalLedgerPort extends Context.Tag('FiscalLedgerPort')<
  FiscalLedgerPort,
  LedgerSourceOps
>() {}

export class BankLedgerPort extends Context.Tag('BankLedgerPort')<
  BankLedgerPort,
  LedgerSourceOps
>() {}
