import { Schema } from 'effect'

import { WEEKDAYS } from '../utils/business-hours'

// Discriminated by `kind`:
// - 'recurring': repeats every week on `weekday` between `open` and `close`
//   (HH:mm). Example: "Almoço" every weekday 12-13.
// - 'one_off': a one-time interval given as UTC ISO `startAt`/`endAt`. Example:
//   "Médico" 2026-05-20 14:00–16:00 BR.
//
// Scope:
// - `unitId` is always set — blocks live within a unit's agenda.
// - `memberOperationId` is optional: when set, only that memberOperation is blocked;
//   when null, the block applies to the whole unit (all memberOperations).
//
// Render rules (and future create-time validation in #636) treat both kinds
// identically: a UTC interval intersected with the day's grid window.
const AgendaBlockBaseFields = {
  id: Schema.String,
  orgId: Schema.String,
  unitId: Schema.String,
  memberOperationId: Schema.NullOr(Schema.String),
  reason: Schema.String,
  createdAt: Schema.String,
  updatedAt: Schema.String,
}

export const RecurringAgendaBlock = Schema.mutable(
  Schema.Struct({
    ...AgendaBlockBaseFields,
    kind: Schema.Literal('recurring'),
    weekday: Schema.Literal(...WEEKDAYS),
    open: Schema.String,
    close: Schema.String,
    startAt: Schema.Null,
    endAt: Schema.Null,
  }),
)
export type RecurringAgendaBlock = typeof RecurringAgendaBlock.Type

export const OneOffAgendaBlock = Schema.mutable(
  Schema.Struct({
    ...AgendaBlockBaseFields,
    kind: Schema.Literal('one_off'),
    weekday: Schema.Null,
    open: Schema.Null,
    close: Schema.Null,
    startAt: Schema.String,
    endAt: Schema.String,
  }),
)
export type OneOffAgendaBlock = typeof OneOffAgendaBlock.Type

export const AgendaBlock = Schema.Union(RecurringAgendaBlock, OneOffAgendaBlock)
export type AgendaBlock = typeof AgendaBlock.Type

// Flat partial over BOTH variants' fields — for an `updated` patch that may
// touch a field of either kind. A union-partial (`Schema.partial(AgendaBlock)`)
// would match an arbitrary member when the `kind` discriminant is absent from
// the patch and silently drop the other variant's fields, so the patch schema
// flattens the field sets (variant-specific fields nullable to span both kinds).
export const AgendaBlockChanges = Schema.partial(
  Schema.Struct({
    ...AgendaBlockBaseFields,
    kind: Schema.Literal('recurring', 'one_off'),
    weekday: Schema.NullOr(Schema.Literal(...WEEKDAYS)),
    open: Schema.NullOr(Schema.String),
    close: Schema.NullOr(Schema.String),
    startAt: Schema.NullOr(Schema.String),
    endAt: Schema.NullOr(Schema.String),
  }),
)
export type AgendaBlockChanges = typeof AgendaBlockChanges.Type

export const AGENDA_BLOCK_KINDS = ['recurring', 'one_off'] as const
export const AgendaBlockKind = Schema.Literal(...AGENDA_BLOCK_KINDS)
export type AgendaBlockKind = typeof AgendaBlockKind.Type
