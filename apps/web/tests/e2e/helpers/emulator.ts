import { authEmulatorHost, emulatorProjectId } from '@cbrl/testing/firebase'

export const AUTH_HOST = authEmulatorHost()
export const PROJECT_ID = emulatorProjectId()

export function appBaseUrl(): string {
  const port = process.env.E2E_PORT
  if (!port) {
    throw new Error(
      'E2E_PORT is not set — launch E2E through scripts/e2e-with-postgres.mjs (it owns the port).',
    )
  }
  return `http://127.0.0.1:${port}`
}
