import { StoredProfessional } from '@/domain/types/professional'
import { Schema } from 'effect'

export const ProfessionalCreatedSchema = Schema.Struct({
  _tag: Schema.Literal('professional.created'),
  data: StoredProfessional,
})

export const ProfessionalUpdatedSchema = Schema.Struct({
  _tag: Schema.Literal('professional.updated'),
  changes: Schema.partial(StoredProfessional),
})

export const ProfessionalDeletedSchema = Schema.Struct({
  _tag: Schema.Literal('professional.deleted'),
})

export const ProfessionalActivatedSchema = Schema.Struct({
  _tag: Schema.Literal('professional.activated'),
})

export const ProfessionalSuspendedSchema = Schema.Struct({
  _tag: Schema.Literal('professional.suspended'),
})

export const ProfessionalEventSchema = Schema.Union(
  ProfessionalCreatedSchema,
  ProfessionalUpdatedSchema,
  ProfessionalDeletedSchema,
  ProfessionalActivatedSchema,
  ProfessionalSuspendedSchema,
)

export type ProfessionalCreated = typeof ProfessionalCreatedSchema.Type
export type ProfessionalUpdated = typeof ProfessionalUpdatedSchema.Type
export type ProfessionalDeleted = typeof ProfessionalDeletedSchema.Type
export type ProfessionalActivated = typeof ProfessionalActivatedSchema.Type
export type ProfessionalSuspended = typeof ProfessionalSuspendedSchema.Type
export type ProfessionalEvent = typeof ProfessionalEventSchema.Type
