import { getApps, initializeApp, type FirebaseApp } from 'firebase/app'
import { connectAuthEmulator, getAuth, type Auth } from 'firebase/auth'
import { getFirebaseConfig } from './config'

let cachedApp: FirebaseApp | undefined
let authEmulatorWired = false

const useEmulators = process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === 'true'

export function getClientApp(): FirebaseApp {
  if (cachedApp) return cachedApp
  const existing = getApps()[0]
  if (existing) {
    cachedApp = existing
    return existing
  }
  const config = getFirebaseConfig()
  if (!config) {
    throw new Error(
      `Expected NEXT_PUBLIC_FIREBASE_{API_KEY,AUTH_DOMAIN,PROJECT_ID,APP_ID} to be set, got: incomplete config`,
    )
  }
  cachedApp = initializeApp(config)
  return cachedApp
}

export function getClientAuth(): Auth {
  const auth = getAuth(getClientApp())
  if (useEmulators && !authEmulatorWired) {
    // Connect to the emulator on the SAME host the page was loaded from, so the
    // app works over localhost AND over the LAN/.local hostname (e.g. testing on
    // a phone/tablet at ideapad.local:3005). Falls back to loopback under SSR.
    const emuHost = typeof window !== 'undefined' ? window.location.hostname : '127.0.0.1'
    connectAuthEmulator(auth, `http://${emuHost}:9099`, { disableWarnings: true })
    authEmulatorWired = true
  }
  return auth
}
