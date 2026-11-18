import { supabaseSsl } from '@cbrl/pg'
import { describe, expect, it } from 'vitest'
import { EVENT_STORE_POOL_CONFIG } from './pool'

describe('EVENT_STORE_POOL_CONFIG', () => {
  it('reads the connection string and registers under its database name', () => {
    expect(EVENT_STORE_POOL_CONFIG.connectionStringEnvVar).toBe('OILIO_DATABASE_URL')
    expect(EVENT_STORE_POOL_CONFIG.database).toBe('oilio')
  })

  it('verifies Supabase hosts against the pinned root CA', () => {
    expect(EVENT_STORE_POOL_CONFIG.passwordModeSsl).toBe(supabaseSsl)
  })
})
