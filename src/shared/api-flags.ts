import { isFeatureEnabled, type FeatureFlag } from '@/shared/flags'
import { NextResponse } from 'next/server'

export function flagNotFound(flag: FeatureFlag): NextResponse | null {
  if (isFeatureEnabled(flag)) return null
  return NextResponse.json({ error: 'Not found' }, { status: 404 })
}
