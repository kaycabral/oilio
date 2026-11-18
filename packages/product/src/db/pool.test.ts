import type * as CloudSql from '@cbrl/pg/cloud-sql'
import { cloudSqlIam } from '@cbrl/pg/cloud-sql'
import { describe, expect, it, vi } from 'vitest'
import { PRODUCT_POOL_CONFIG } from './pool'

vi.mock('@cbrl/pg/cloud-sql', async (importOriginal) => {
  const actual = await importOriginal<typeof CloudSql>()
  return { cloudSqlIam: vi.fn(actual.cloudSqlIam) }
})

describe('PRODUCT_POOL_CONFIG', () => {
  it('keeps the password-mode connection string and database', () => {
    expect(PRODUCT_POOL_CONFIG.connectionStringEnvVar).toBe('DATABASE_URL')
    expect(PRODUCT_POOL_CONFIG.database).toBe('produtos')
  })

  it('switches to IAM on the production flag env var', () => {
    expect(PRODUCT_POOL_CONFIG.iam?.enabledEnvVar).toBe('PRODUCT_USE_IAM_AUTH')
  })

  it('maps the Cloud SQL instance and IAM user to the production env vars', () => {
    expect(vi.mocked(cloudSqlIam)).toHaveBeenCalledExactlyOnceWith({
      enabledEnvVar: 'PRODUCT_USE_IAM_AUTH',
      instanceEnvVar: 'PRODUCT_CLOUDSQL_INSTANCE',
      userEnvVar: 'PRODUCT_IAM_DB_USER',
    })
  })
})
