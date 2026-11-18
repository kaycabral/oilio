import { supabaseSsl } from '@cbrl/pg'
import { describe, expect, it } from 'vitest'
import { PRODUCT_POOL_CONFIG } from './pool'

describe('PRODUCT_POOL_CONFIG', () => {
  it('reads the connection string and registers under its database name', () => {
    expect(PRODUCT_POOL_CONFIG.connectionStringEnvVar).toBe('DATABASE_URL')
    expect(PRODUCT_POOL_CONFIG.database).toBe('produtos')
  })

  it('verifies Supabase hosts against the pinned root CA', () => {
    expect(PRODUCT_POOL_CONFIG.passwordModeSsl).toBe(supabaseSsl)
  })
})
