import { e2eSupabase } from './app-env'

const TIMEOUT_MS = 30_000
const INTERVAL_MS = 200

async function tryEventStoreRoundtrip(): Promise<boolean> {
  if (!process.env.OILIO_DATABASE_URL) return true
  const { Client } = await import('pg')
  const client = new Client({ connectionString: process.env.OILIO_DATABASE_URL })
  try {
    await client.connect()
    await client.query('SELECT 1')
    return true
  } catch {
    return false
  } finally {
    await client.end().catch(() => {})
  }
}

async function tryAuthHealth(): Promise<boolean> {
  const { apiUrl, secretKey } = e2eSupabase()
  try {
    const res = await fetch(`${apiUrl}/auth/v1/health`, { headers: { apikey: secretKey } })
    return res.ok
  } catch {
    return false
  }
}

async function waitFor(label: string, probe: () => Promise<boolean>): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < TIMEOUT_MS) {
    if (await probe()) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS))
  }
  throw new Error(`[e2e] ${label} warmup failed after ${TIMEOUT_MS}ms — local Supabase may be down`)
}

export default async function globalSetup(): Promise<void> {
  await Promise.all([waitFor('Auth', tryAuthHealth), waitFor('EventStore', tryEventStoreRoundtrip)])
}
