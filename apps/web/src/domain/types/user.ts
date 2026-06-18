import { Schema } from 'effect'

import { TaxIdentity } from './tax'

const userCommonFields = {
  uid: Schema.String,
  email: Schema.NullOr(Schema.String),
  displayName: Schema.NullOr(Schema.String),
  avatarUrl: Schema.NullOr(Schema.String),
  emailVerified: Schema.Boolean,
  currentOrgId: Schema.NullOr(Schema.String),
  // PF/PJ identity. Same shape used by Org and Professional. Null until the
  // user activates a role that requires it. See [[02-Estrategia-Modelo-Identidade]].
  taxIdentity: Schema.NullOr(TaxIdentity),
  // Personal description and skills surfaced on professional profiles.
  bio: Schema.NullOr(Schema.String),
  specialties: Schema.NullOr(Schema.mutable(Schema.Array(Schema.String))),
  // Timestamp when the doc became backed by a Firebase Auth identity (#839).
  // Null on stubs created by the recepcionista path.
  claimedAt: Schema.NullOr(Schema.String),
  // LGPD — proof the user accepted the current Terms / Privacy versions.
  termsAcceptedAt: Schema.NullOr(Schema.String),
  termsVersion: Schema.NullOr(Schema.String),
  privacyAcceptedAt: Schema.NullOr(Schema.String),
  privacyVersion: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String,
}

// WhatsApp (canonical contact channel) and birthDate (ISO `YYYY-MM-DD`, powers
// aniversariantes) are modeled as a discriminated union across the account's two
// independent axes — `completionCompleted` and `anonymizedAt` — so the only
// representable states are the real ones:
//   • Incomplete — post-OAuth, before the completion step (#838): PII nullable.
//   • Complete   — completion done (whatsapp ∧ birthDate REQUIRED).
//   • Anonymized — LGPD art. 18 erasure (#1093): PII scrubbed to null.
// A "completed account with no whatsapp" can ONLY exist via the Anonymized
// branch (`anonymizedAt` set); any other path producing it fails to decode.

const UserIncomplete = Schema.mutable(
  Schema.Struct({
    ...userCommonFields,
    anonymizedAt: Schema.Null,
    completionCompleted: Schema.Literal(false),
    whatsapp: Schema.NullOr(Schema.String),
    birthDate: Schema.NullOr(Schema.String),
  }),
)

const UserComplete = Schema.mutable(
  Schema.Struct({
    ...userCommonFields,
    anonymizedAt: Schema.Null,
    completionCompleted: Schema.Literal(true),
    whatsapp: Schema.String,
    birthDate: Schema.String,
  }),
)

const UserAnonymized = Schema.mutable(
  Schema.Struct({
    ...userCommonFields,
    anonymizedAt: Schema.String,
    completionCompleted: Schema.Boolean,
    whatsapp: Schema.Null,
    birthDate: Schema.Null,
  }),
)

export const User = Schema.Union(UserIncomplete, UserComplete, UserAnonymized)
export type User = typeof User.Type
export type UserComplete = typeof UserComplete.Type
export type UserIncomplete = typeof UserIncomplete.Type
export type UserAnonymized = typeof UserAnonymized.Type
