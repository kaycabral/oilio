import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { closeEventStoreDb, getEventStorePool } from '../pool'

const ORG = 'org-nonempty'

async function seedOrg(id: string): Promise<void> {
  await getEventStorePool().query(
    `INSERT INTO orgs (org_id, id, last_event_version, name, slug, vertical, owner_user_id, branding, created_at, updated_at)
     VALUES ($1,$1,1,'Org','slug-'||$1,'barbershop','owner','{}'::jsonb,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`,
    [id],
  )
}

beforeAll(async () => {
  await getEventStorePool().query(`DELETE FROM units_pii WHERE org_id = $1`, [ORG])
  await getEventStorePool().query(`DELETE FROM invites_pii WHERE org_id = $1`, [ORG])
  await getEventStorePool().query(`DELETE FROM users WHERE uid LIKE 'u-nonempty-%'`)
  await getEventStorePool().query(`DELETE FROM orgs WHERE org_id = $1`, [ORG])
  await seedOrg(ORG)
})

beforeEach(async () => {
  await getEventStorePool().query(`DELETE FROM units_pii WHERE org_id = $1`, [ORG])
  await getEventStorePool().query(`DELETE FROM invites_pii WHERE org_id = $1`, [ORG])
  await getEventStorePool().query(`DELETE FROM users WHERE uid LIKE 'u-nonempty-%'`)
})

afterAll(async () => {
  await getEventStorePool().query(`DELETE FROM units_pii WHERE org_id = $1`, [ORG])
  await getEventStorePool().query(`DELETE FROM invites_pii WHERE org_id = $1`, [ORG])
  await getEventStorePool().query(`DELETE FROM users WHERE uid LIKE 'u-nonempty-%'`)
  await getEventStorePool().query(`DELETE FROM orgs WHERE org_id = $1`, [ORG])
  await closeEventStoreDb()
})

describe('PII contact non-empty constraints (#1283 Group B)', () => {
  it('rejects an empty units_pii.mobile (AC-03)', async () => {
    await expect(
      getEventStorePool().query(
        `INSERT INTO units_pii (org_id, id, mobile, email) VALUES ($1,'unit-1','',NULL)`,
        [ORG],
      ),
    ).rejects.toThrow(/units_pii_mobile_(nonempty|br_format)/)
  })

  it('accepts a real units_pii.mobile', async () => {
    await expect(
      getEventStorePool().query(
        `INSERT INTO units_pii (org_id, id, mobile, email) VALUES ($1,'unit-2','5511999990000',NULL)`,
        [ORG],
      ),
    ).resolves.toBeDefined()
  })

  it('rejects an empty invites_pii.mobile (AC-03)', async () => {
    await expect(
      getEventStorePool().query(
        `INSERT INTO invites_pii (org_id, id, mobile) VALUES ($1,'inv-1','')`,
        [ORG],
      ),
    ).rejects.toThrow(/invites_pii_mobile_(nonempty|br_format)/)
  })

  it('rejects a completed user with an empty mobile (AC-04)', async () => {
    await expect(
      getEventStorePool().query(
        `INSERT INTO users (uid, email_verified, completion_completed, mobile, birth_date, created_at, updated_at)
         VALUES ('u-nonempty-1', true, true, '', '1990-01-01', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
      ),
    ).rejects.toThrow(/users_completed_profile_complete/)
  })

  it('accepts a completed user with a real mobile', async () => {
    await expect(
      getEventStorePool().query(
        `INSERT INTO users (uid, email_verified, completion_completed, mobile, birth_date, created_at, updated_at)
         VALUES ('u-nonempty-2', true, true, '5511977776666', '1990-01-01', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
      ),
    ).resolves.toBeDefined()
  })
})
