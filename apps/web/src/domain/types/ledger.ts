import { Schema } from 'effect'

import { MoneySchema } from '@/domain/value-objects'

export const LEDGER_NATURES = [
  'revenue',
  'cmv',
  'csp',
  'expense_commercial',
  'expense_admin',
  'expense_financial',
  'tax_on_sale',
  'tax_on_profit',
] as const
export const LedgerNature = Schema.Literal(...LEDGER_NATURES)
export type LedgerNature = typeof LedgerNature.Type

export const LEDGER_BEHAVIORS = ['variable', 'fixed'] as const
export const LedgerBehavior = Schema.Literal(...LEDGER_BEHAVIORS)
export type LedgerBehavior = typeof LedgerBehavior.Type

export const LEDGER_LINKS = ['item', 'sale', 'unit'] as const
export const LedgerLink = Schema.Literal(...LEDGER_LINKS)
export type LedgerLink = typeof LedgerLink.Type

export const LEDGER_SOURCES = ['order', 'commission', 'charge', 'cash_movement', 'manual'] as const
export const LedgerSource = Schema.Literal(...LEDGER_SOURCES)
export type LedgerSource = typeof LedgerSource.Type

export const LedgerEntry = Schema.Struct({
  id: Schema.String,
  orgId: Schema.String,
  unitId: Schema.String,
  nature: LedgerNature,
  behavior: LedgerBehavior,
  link: LedgerLink,
  amountCents: MoneySchema,
  direction: Schema.Literal('in', 'out'),
  source: LedgerSource,
  sourceId: Schema.String,
  itemId: Schema.NullOr(Schema.String),
  occurredAt: Schema.String,
})
export type LedgerEntry = typeof LedgerEntry.Type
