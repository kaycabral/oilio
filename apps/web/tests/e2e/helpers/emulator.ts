// Single source for the Firebase emulator coordinates used by E2E specs +
// helpers. Re-exports the canonical readers from `@cbrl/testing/firebase` under
// the constant names the specs already use. Values come from the env that
// `firebase emulators:exec` injects (FIREBASE_AUTH_EMULATOR_HOST / GCLOUD_PROJECT);
// the readers fail loudly here if the suite wasn't launched under emulators:exec,
// instead of every spec silently hitting a wrong host.

import { authEmulatorHost, emulatorProjectId } from '@cbrl/testing/firebase'

export const AUTH_HOST = authEmulatorHost()
export const PROJECT_ID = emulatorProjectId()

// Base URL of the Next server under test. The runner (`scripts/e2e-with-postgres
// .mjs`) is the single source of truth for the port: it picks a FREE port per run
// and exports it as `E2E_PORT` (CI/local both), and `playwright.config.ts` derives
// its `baseURL` from the same var. Helpers that POST to the app outside the page
// (e.g. `signInAndAttachSession` → `/api/session`) MUST resolve the host the same
// way — never a hardcoded `:3005`, which only happens to be the dev default and
// breaks under the isolated per-run port.
//
// Fails loud when `E2E_PORT` is absent: this is only ever called while making a
// real request to the app, so a missing port is a misconfiguration (the suite
// wasn't launched through the runner), not a value to paper over with a default.
export function appBaseUrl(): string {
  const port = process.env.E2E_PORT
  if (!port) {
    throw new Error(
      'E2E_PORT is not set — launch E2E through scripts/e2e-with-postgres.mjs (it owns the port).',
    )
  }
  return `http://127.0.0.1:${port}`
}
