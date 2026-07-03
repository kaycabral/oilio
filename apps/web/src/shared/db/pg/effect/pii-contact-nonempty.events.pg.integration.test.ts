import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { closeEventStoreDb, getEventStorePool } from '../pool'

/**
 * Proof that the DB rejects an empty required contact PII (#1283, brief 0078
 * Group B). `units_pii.whatsapp` and `invites_pii.whatsapp` are NOT NULL but a bare
 * `''` satisfied NOT NULL before the `*_nonempty` CHECK; and a `''` whatsapp on a
 * `completion_completed` user satisfied the old `IS NOT NULL` branch of
 * `users_completed_profile_complete`. These run against the ephemeral Postgres
 * over the superuser pool (the CHECK is enforced regardless of RLS role).
 */

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
  it('rejects an empty units_pii.whatsapp (AC-03)', async () => {
    await expect(
      getEventStorePool().query(
        `INSERT INTO units_pii (org_id, id, whatsapp, email) VALUES ($1,'unit-1','',NULL)`,
        [ORG],
      ),
    ).rejects.toThrow(/units_pii_whatsapp_nonempty/)
  })

  it('accepts a real units_pii.whatsapp', async () => {
    await expect(
      getEventStorePool().query(
        `INSERT INTO units_pii (org_id, id, whatsapp, email) VALUES ($1,'unit-2','+5511999990000',NULL)`,
        [ORG],
      ),
    ).resolves.toBeDefined()
  })

  it('rejects an empty invites_pii.whatsapp (AC-03)', async () => {
    await expect(
      getEventStorePool().query(
        `INSERT INTO invites_pii (org_id, id, whatsapp) VALUES ($1,'inv-1','')`,
        [ORG],
      ),
    ).rejects.toThrow(/invites_pii_whatsapp_nonempty/)
  })

  it('rejects a completed user with an empty whatsapp (AC-04)', async () => {
    await expect(
      getEventStorePool().query(
        `INSERT INTO users (uid, email_verified, completion_completed, whatsapp, birth_date, created_at, updated_at)
         VALUES ('u-nonempty-1', true, true, '', '1990-01-01', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
      ),
    ).rejects.toThrow(/users_completed_profile_complete/)
  })

  it('accepts a completed user with a real whatsapp', async () => {
    await expect(
      getEventStorePool().query(
        `INSERT INTO users (uid, email_verified, completion_completed, whatsapp, birth_date, created_at, updated_at)
         VALUES ('u-nonempty-2', true, true, '+5511988887777', '1990-01-01', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
      ),
    ).resolves.toBeDefined()
  })
})
