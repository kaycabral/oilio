import { requireEnv } from '@cbrl/env'
import { request } from '@playwright/test'

import { SMOKE_STORAGE_STATE } from './storage-state'

function bypassHeaders(): Record<string, string> {
  const secret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET
  if (!secret) return {}
  return { 'x-vercel-protection-bypass': secret, 'x-vercel-set-bypass-cookie': 'true' }
}

export default async function globalSetup(): Promise<void> {
  const baseURL = requireEnv('SMOKE_BASE_URL')
  const context = await request.newContext({ baseURL, extraHTTPHeaders: bypassHeaders() })
  try {
    const res = await context.get('/api/health')
    const landedOn = new URL(res.url()).host
    if (landedOn !== new URL(baseURL).host) {
      throw new Error(
        `${baseURL} redirected to ${landedOn}: the deployment is behind Vercel Deployment Protection. ` +
          'Set the VERCEL_AUTOMATION_BYPASS_SECRET secret (Protection Bypass for Automation).',
      )
    }
    await context.storageState({ path: SMOKE_STORAGE_STATE })
  } finally {
    await context.dispose()
  }
}
