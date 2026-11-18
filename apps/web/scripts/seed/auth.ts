// Supabase Auth identity for seeded users that need to LOG IN locally.
//
// Login reads the Supabase session, so a seeded persona can only open the app
// if it has an Auth identity on the LOCAL stack. The uid is FIXED (pinned via
// `app_metadata.oilio_uid`) so the identity maps to the same `seed-*` rows the
// event store seeded; a random uid would open a fresh, empty onboarding.
// Idempotent: a re-run replaces the record. Locally, personas sign in with
// email + SEED_PERSONA_PASSWORD (email/password exists only on the local
// stack; production is Google only).
//
// Only a subset of seeded users get an Auth identity (the ones a tester logs in
// as); everyone else exists purely as data (the `users` table + projections).

import { replaceIdentity } from '@/shared/auth/identity-provisioning'
import { createClient } from '@supabase/supabase-js'

import { readLocalSupabase } from '../local-supabase'

export const SEED_PERSONA_PASSWORD = 'oilio-local-dev'

export interface AuthIdentity {
  uid: string
  email: string
  displayName: string
}

function localAdmin() {
  const local = readLocalSupabase()
  return createClient(local.apiUrl, local.secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

export async function ensureAuthIdentity(identity: AuthIdentity): Promise<void> {
  await replaceIdentity(localAdmin(), {
    uid: identity.uid,
    email: identity.email,
    displayName: identity.displayName,
    password: SEED_PERSONA_PASSWORD,
  })
}
