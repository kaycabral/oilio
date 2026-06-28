// LGPD account-level anonymization helpers (brief 0032 / #1093).
//
// Erasure scope is the global account (`users/{uid}`) — the only place the
// person's name ever lived. Anonymizing scrubs that doc to neutral/empty
// values and sets `anonymizedAt`. Records (orders/commissions/memberships/…)
// keep their `userId` pointer untouched; they resolve to a neutral display
// label because the account is anonymized. There is NO reverse map (art. 12):
// the scrub is irreversible and these helpers never reconstruct the old PII.

import type { Role } from '../types/enums'
import type { User } from '../types/user'

// Determines whether an account has been irreversibly anonymized. The display
// layer (#1095) uses this to swap the live name for the neutral label.
export function isAnonymized(user: Pick<User, 'anonymizedAt'>): boolean {
  return user.anonymizedAt !== null && user.anonymizedAt !== undefined
}

// Crockford base32 alphabet without ambiguous characters (no I, L, O, U).
const SUBJECT_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const SUBJECT_CODE_LENGTH = 4

// Derives a deterministic 4-char code from a `userId` (FNV-1a → base32, no
// ambiguous chars). Purely cosmetic: it only distinguishes anonymized rows in
// a list (e.g. "Cliente 7K2A"). It is NOT a reverse map — you cannot recover
// the user from the code, and collisions across the whole user base are
// acceptable for this display-only purpose. The display layer (#1095) consumes
// this to render `‹Role› ‹CODE›`. Stable for a given `userId`.
export function anonymizedSubjectCode(userId: string): string {
  // FNV-1a 32-bit.
  let hash = 0x811c9dc5
  for (let i = 0; i < userId.length; i += 1) {
    hash ^= userId.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  let value = hash >>> 0
  let code = ''
  for (let i = 0; i < SUBJECT_CODE_LENGTH; i += 1) {
    code += SUBJECT_CODE_ALPHABET[value % SUBJECT_CODE_ALPHABET.length]
    value = Math.floor(value / SUBJECT_CODE_ALPHABET.length)
  }
  return code
}

// The role noun used to build the neutral label per surface (#1095, AC-03).
// Owner/manager surfaces still read as the operational noun a screen shows
// (member lists are role-keyed, customer lists are always "Cliente"). Kept
// in sync with the human-facing ROLE_LABELS used across the app.
export const ROLE_SUBJECT_NOUN: Record<Role, string> = {
  owner: 'Dono',
  manager: 'Gerente',
  member_operator: 'Profissional',
  receptionist: 'Recepção',
}

// Builds the neutral display label `‹Role› ‹CODE›` (ex.: "Cliente 7K2A") for an
// anonymized account. Transparent — no "removido"/reason; the code only keeps
// rows distinct (AC-03). `noun` is the entity noun appropriate to the surface.
export function anonymizedLabel(userId: string, noun: string): string {
  return `${noun} ${anonymizedSubjectCode(userId)}`
}

// A subject whose data has been blocked (LGPD art. 18 "bloqueio") in a single
// org (brief 0032 / #1096, AC-09). Unlike account anonymization, the global
// account stays intact — the blockage is per-org and reversible. The marker
// lives at `orgs/{orgId}/blocked_subjects/{userId}`; `blockedAt` is the
// ISO proof timestamp. The display layer keys off the marker's existence to
// swap the live name for the neutral label IN THAT ORG only.
export type BlockedSubject = {
  blockedAt: string
}

// Options for `resolveSubjectName`. `blockedInOrg` is true when the subject
// has a `blocked_subjects` marker in the surface's org (#1096, AC-09) — the
// caller loads the org's blocked set once and passes the per-row result.
export type ResolveSubjectNameOpts = {
  blockedInOrg?: boolean
}

// Resolves the name to display for an account, applying the LGPD neutral
// fallback at the single resolution layer. The neutral label `‹Role› ‹CODE›`
// surfaces when EITHER:
//   - the global account is anonymized (#1095, AC-03 — applies everywhere), OR
//   - the subject is blocked in this org (#1096, AC-09 — per-org; the
//     global account and other orgs keep the live name).
// Otherwise a non-anonymized account keeps its live `displayName`. `noun` is
// the surface's role/entity noun (Cliente / Profissional / Recepção / Membro).
// `userId` is the global account id used to derive the distinguishing code.
export function resolveSubjectName(
  userId: string,
  user: Pick<User, 'displayName' | 'anonymizedAt'> | undefined,
  noun: string,
  opts?: ResolveSubjectNameOpts,
): string | null {
  if (!user) return null
  if (isAnonymized(user) || opts?.blockedInOrg === true) {
    return anonymizedLabel(userId, noun)
  }
  return user.displayName
}

// Resolves the avatar to display, applying the LGPD neutral fallback at the
// same single resolution layer as the name. The photo is BLANKED (null — UI
// renders its placeholder) when EITHER the global account is anonymized
// (#1093 already nulls `avatarUrl` on `users/{uid}`) OR the subject is blocked
// in this org (#1096/#1100, AC-13 — the photo is a re-identification vector,
// so a blocked customer's surfaces in this org show no photo even though the
// global account keeps it). `blockedInOrg` is the CUSTOMER per-org block;
// it never applies to a memberOperation (the employment relationship stays
// identifiable — brief 0041).
export function resolveSubjectAvatar(
  user: Pick<User, 'avatarUrl' | 'anonymizedAt'> | undefined,
  opts?: ResolveSubjectNameOpts,
): string | null {
  if (!user) return null
  if (isAnonymized(user) || opts?.blockedInOrg === true) return null
  return user.avatarUrl
}

// The fields written to `users/{uid}` when anonymizing. PII columns go to
// neutral/empty values; `anonymizedAt` carries the proof timestamp. Callers
// pass `now` (ISO) so the write and the `updatedAt` bump stay consistent.
export type UserAnonymizationScrub = Pick<
  User,
  | 'displayName'
  | 'whatsapp'
  | 'email'
  | 'birthDate'
  | 'taxIdentity'
  | 'bio'
  | 'specialties'
  | 'avatarUrl'
  | 'anonymizedAt'
  | 'updatedAt'
>

// Builds the scrub patch for the global account doc. All identifying fields
// collapse to null; `anonymizedAt`/`updatedAt` record the operation. This is
// the single source of truth for what "anonymized" means on `users/{uid}`.
export function buildUserAnonymizationScrub(now: string): UserAnonymizationScrub {
  return {
    displayName: null,
    whatsapp: null,
    email: null,
    birthDate: null,
    taxIdentity: null,
    bio: null,
    specialties: null,
    avatarUrl: null,
    anonymizedAt: now,
    updatedAt: now,
  }
}
