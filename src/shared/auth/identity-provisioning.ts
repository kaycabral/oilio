import type { SupabaseClient, User } from '@supabase/supabase-js'
import { LEGACY_UID_CLAIM } from './session-user'

export type IdentitySpec = {
  email: string
  uid?: string
  displayName?: string | null
  avatarUrl?: string | null
  password?: string
}

export type ProvisionedIdentity = {
  authUserId: string
  uid: string
}

const PAGE_SIZE = 1000

export async function findAuthUserByEmail(
  admin: SupabaseClient,
  email: string,
): Promise<User | null> {
  const target = email.toLowerCase()
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: PAGE_SIZE })
    if (error) throw error
    const found = data.users.find((u) => u.email?.toLowerCase() === target)
    if (found) return found
    if (data.users.length < PAGE_SIZE) return null
  }
}

export async function createIdentity(
  admin: SupabaseClient,
  spec: IdentitySpec,
): Promise<ProvisionedIdentity> {
  const { data, error } = await admin.auth.admin.createUser({
    email: spec.email,
    email_confirm: true,
    ...(spec.password ? { password: spec.password } : {}),
    app_metadata: spec.uid ? { [LEGACY_UID_CLAIM]: spec.uid } : {},
    user_metadata: {
      email_verified: true,
      ...(spec.displayName ? { full_name: spec.displayName } : {}),
      ...(spec.avatarUrl ? { avatar_url: spec.avatarUrl } : {}),
    },
  })
  if (error) throw error
  return { authUserId: data.user.id, uid: spec.uid ?? data.user.id }
}

export async function replaceIdentity(
  admin: SupabaseClient,
  spec: IdentitySpec,
): Promise<ProvisionedIdentity> {
  const existing = await findAuthUserByEmail(admin, spec.email)
  if (existing) {
    const { error } = await admin.auth.admin.deleteUser(existing.id)
    if (error) throw error
  }
  return createIdentity(admin, spec)
}
