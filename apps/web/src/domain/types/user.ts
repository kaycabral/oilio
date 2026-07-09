import { Schema } from 'effect'

import { TaxIdentity } from './tax'

const userCommonFields = {
  uid: Schema.String,
  email: Schema.NullOr(Schema.String),
  displayName: Schema.NullOr(Schema.String),
  avatarUrl: Schema.NullOr(Schema.String),
  emailVerified: Schema.Boolean,
  currentOrgId: Schema.NullOr(Schema.String),
  taxIdentity: Schema.NullOr(TaxIdentity),
  bio: Schema.NullOr(Schema.String),
  specialties: Schema.NullOr(Schema.mutable(Schema.Array(Schema.String))),
  claimedAt: Schema.NullOr(Schema.String),
  termsAcceptedAt: Schema.NullOr(Schema.String),
  termsVersion: Schema.NullOr(Schema.String),
  privacyAcceptedAt: Schema.NullOr(Schema.String),
  privacyVersion: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String,
}

const UserIncomplete = Schema.mutable(
  Schema.Struct({
    ...userCommonFields,
    anonymizedAt: Schema.Null,
    completionCompleted: Schema.Literal(false),
    mobile: Schema.NullOr(Schema.String),
    birthDate: Schema.NullOr(Schema.String),
  }),
)

const UserComplete = Schema.mutable(
  Schema.Struct({
    ...userCommonFields,
    anonymizedAt: Schema.Null,
    completionCompleted: Schema.Literal(true),
    mobile: Schema.String,
    birthDate: Schema.String,
  }),
)

const UserAnonymized = Schema.mutable(
  Schema.Struct({
    ...userCommonFields,
    anonymizedAt: Schema.String,
    completionCompleted: Schema.Boolean,
    mobile: Schema.Null,
    birthDate: Schema.Null,
  }),
)

export const User = Schema.Union(UserIncomplete, UserComplete, UserAnonymized)
export type User = typeof User.Type
export type UserComplete = typeof UserComplete.Type
export type UserIncomplete = typeof UserIncomplete.Type
export type UserAnonymized = typeof UserAnonymized.Type
