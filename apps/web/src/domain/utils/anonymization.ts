import type { Role } from '../types/enums'
import type { User } from '../types/user'

export function isAnonymized(user: Pick<User, 'anonymizedAt'>): boolean {
  return user.anonymizedAt !== null && user.anonymizedAt !== undefined
}

const SUBJECT_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const SUBJECT_CODE_LENGTH = 4

export function anonymizedSubjectCode(userId: string): string {
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

export const ROLE_SUBJECT_NOUN: Record<Role, string> = {
  owner: 'Dono',
  manager: 'Gerente',
  member_operator: 'Profissional',
  receptionist: 'Recepção',
}

export function anonymizedLabel(userId: string, noun: string): string {
  return `${noun} ${anonymizedSubjectCode(userId)}`
}

export type BlockedSubject = {
  blockedAt: string
}

export type ResolveSubjectNameOpts = {
  blockedInOrg?: boolean
}

//     global account and other orgs keep the live name).
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

// global account keeps it). `blockedInOrg` is the CUSTOMER per-org block;
export function resolveSubjectAvatar(
  user: Pick<User, 'avatarUrl' | 'anonymizedAt'> | undefined,
  opts?: ResolveSubjectNameOpts,
): string | null {
  if (!user) return null
  if (isAnonymized(user) || opts?.blockedInOrg === true) return null
  return user.avatarUrl
}

export type UserAnonymizationScrub = Pick<
  User,
  | 'displayName'
  | 'mobile'
  | 'email'
  | 'birthDate'
  | 'taxIdentity'
  | 'bio'
  | 'specialties'
  | 'avatarUrl'
  | 'anonymizedAt'
  | 'updatedAt'
>

export function buildUserAnonymizationScrub(now: string): UserAnonymizationScrub {
  return {
    displayName: null,
    mobile: null,
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
