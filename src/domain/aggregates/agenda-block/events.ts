import { AgendaBlock, AgendaBlockChanges } from '@/domain/types/agenda-block'
import { Schema } from 'effect'

export const AgendaBlockCreatedSchema = Schema.Struct({
  _tag: Schema.Literal('agenda_block.created'),
  data: AgendaBlock,
})

export const AgendaBlockUpdatedSchema = Schema.Struct({
  _tag: Schema.Literal('agenda_block.updated'),
  changes: AgendaBlockChanges,
})

export const AgendaBlockDeletedSchema = Schema.Struct({
  _tag: Schema.Literal('agenda_block.deleted'),
})

export const AgendaBlockEventSchema = Schema.Union([
  AgendaBlockCreatedSchema,
  AgendaBlockUpdatedSchema,
  AgendaBlockDeletedSchema,
])

export type AgendaBlockCreated = typeof AgendaBlockCreatedSchema.Type
export type AgendaBlockUpdated = typeof AgendaBlockUpdatedSchema.Type
export type AgendaBlockDeleted = typeof AgendaBlockDeletedSchema.Type
export type AgendaBlockEvent = typeof AgendaBlockEventSchema.Type
