import { requireEnvOneOf } from '@oilio/env'
import { applicationDefault, cert, getApps, initializeApp, type App } from 'firebase-admin/app'
import { getAuth, type Auth } from 'firebase-admin/auth'

let cachedApp: App | undefined

function getAdminApp(): App {
  if (cachedApp) return cachedApp
  const existing = getApps()[0]
  if (existing) {
    cachedApp = existing
    return existing
  }

  const projectId = requireEnvOneOf(
    'FIREBASE_ADMIN_PROJECT_ID',
    'NEXT_PUBLIC_FIREBASE_PROJECT_ID',
    'GCLOUD_PROJECT',
    'GOOGLE_CLOUD_PROJECT',
  )

  const isEmulator = !!process.env.FIREBASE_AUTH_EMULATOR_HOST
  if (isEmulator) {
    cachedApp = initializeApp({ projectId })
    return cachedApp
  }

  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n')
  const credential =
    clientEmail && privateKey ? cert({ projectId, clientEmail, privateKey }) : applicationDefault()

  cachedApp = initializeApp({ credential, projectId })
  return cachedApp
}

export function getAdminAuth(): Auth {
  return getAuth(getAdminApp())
}
