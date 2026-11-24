import { Schema } from 'effect'

import { WEEKDAYS } from '../utils/business-hours'

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
