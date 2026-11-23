export function appBaseUrl(): string {
  const port = process.env.E2E_PORT
  if (!port) {
    throw new Error(
      'E2E_PORT is not set — launch E2E through `pnpm test:e2e` (scripts/e2e.ts owns the port).',
    )
  }
  return `http://127.0.0.1:${port}`
}

function required(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`${name} is not set — launch E2E through 'pnpm test:e2e'.`)
  }
  return value
}

export function e2eSupabase(): { apiUrl: string; secretKey: string } {
  return {
    apiUrl: required('NEXT_PUBLIC_SUPABASE_URL'),
    secretKey: required('SUPABASE_SECRET_KEY'),
  }
}
