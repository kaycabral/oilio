import type * as CloudSql from '@cbrl/pg/cloud-sql'
import { cloudSqlIam } from '@cbrl/pg/cloud-sql'
import { describe, expect, it, vi } from 'vitest'
import { EVENT_STORE_POOL_CONFIG } from './pool'

vi.mock('@cbrl/pg/cloud-sql', async (importOriginal) => {
  const actual = await importOriginal<typeof CloudSql>()
  return { cloudSqlIam: vi.fn(actual.cloudSqlIam) }
})

describe('EVENT_STORE_POOL_CONFIG', () => {
  it('keeps the password-mode connection string and database', () => {
    expect(EVENT_STORE_POOL_CONFIG.connectionStringEnvVar).toBe('OILIO_DATABASE_URL')
    expect(EVENT_STORE_POOL_CONFIG.database).toBe('oilio')
  })

  it('switches to IAM on the production flag env var', () => {
    expect(EVENT_STORE_POOL_CONFIG.iam?.enabledEnvVar).toBe('OILIO_USE_IAM_AUTH')
  })

  it('maps the Cloud SQL instance and IAM user to the production env vars', () => {
    expect(vi.mocked(cloudSqlIam)).toHaveBeenCalledExactlyOnceWith({
      enabledEnvVar: 'OILIO_USE_IAM_AUTH',
      instanceEnvVar: 'OILIO_CLOUDSQL_INSTANCE',
      userEnvVar: 'OILIO_IAM_DB_USER',
    })
  })
})
