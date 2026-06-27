// Firebase Auth identity for seeded users that need to LOG IN.
//
// The Postgres cutover (#1202) removed Firestore (data), NOT Auth: login still
// runs `verifySessionCookie` against the Auth emulator, so a seeded user can
// only open the app if it has an Auth identity. `@/shared/db` `getAdminAuth()`
// auto-routes to the emulator when `FIREBASE_AUTH_EMULATOR_HOST` is set (which
// `pnpm local` / `db:seed` provide). Idempotent: a re-run overwrites the record.
//
// Provider = `google.com`, with a FIXED uid. The app's only login button is
// "Continuar com Google" (`/login`), so a seeded persona must be a google.com
// identity for that button to land on it — and the uid must be fixed so it maps
// to the same `seed-*` rows the event store seeded (a random uid would open a
// fresh, empty onboarding instead). `importUsers` is the only Admin API that
// pins BOTH the uid and a federated provider; `createUser` can't attach
// `google.com`. The emulator's IdP widget ("Add new account" with the seeded
// email) then signs in AS this uid.
//
// Only a subset of seeded users get an Auth identity (the ones a tester logs in
// as); everyone else exists purely as data (the `users` table + projections).

import { getAdminAuth } from '@/shared/db'

export interface AuthIdentity {
  uid: string
  email: string
  displayName: string
}

export async function ensureAuthIdentity(identity: AuthIdentity): Promise<void> {
  const auth = getAdminAuth()
  // Overwrite-on-rerun: delete any prior record so `importUsers` (which fails on
  // an existing uid) always lands the current email/displayName/provider.
  await auth.deleteUser(identity.uid).catch(() => undefined)
  const result = await auth.importUsers([
    {
      uid: identity.uid,
      email: identity.email,
      emailVerified: true,
      displayName: identity.displayName,
      providerData: [
        {
          uid: identity.email,
          email: identity.email,
          displayName: identity.displayName,
          providerId: 'google.com',
        },
      ],
    },
  ])
  if (result.errors.length > 0) {
    const [first] = result.errors
    throw new Error(`Failed to seed Auth identity ${identity.uid}: ${first?.error.message}`)
  }
}
