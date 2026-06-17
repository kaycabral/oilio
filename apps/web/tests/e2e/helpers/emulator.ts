// Single source for the Firebase emulator coordinates used by E2E specs +
// helpers. Re-exports the canonical readers from `@cbrl/testing/firebase` under
// the constant names the specs already use. Values come from the env that
// `firebase emulators:exec` injects (FIRESTORE_EMULATOR_HOST /
// FIREBASE_AUTH_EMULATOR_HOST / GCLOUD_PROJECT); the readers fail loudly here if
// the suite wasn't launched under emulators:exec, instead of every spec
// silently hitting a wrong host.

import { authEmulatorHost, emulatorProjectId, firestoreEmulatorHost } from '@cbrl/testing/firebase'

export const FIRESTORE_HOST = firestoreEmulatorHost()
export const AUTH_HOST = authEmulatorHost()
export const PROJECT_ID = emulatorProjectId()
