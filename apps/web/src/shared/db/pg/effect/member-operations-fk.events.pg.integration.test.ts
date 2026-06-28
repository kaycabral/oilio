import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeEventStoreDb, getEventStorePool } from '../pool'

/**
 * The operational profile (`professionals`) hangs off the membership — proof
 * against REAL Postgres (brief 0076 AC-02 / AC-05). The composite FK
 * `(org_id, member_id) → memberships(org_id, id)` with `ON DELETE cascade`
 * kills the drift at the root that the runtime `BookableProfessional` brand used
 * to paper over:
 *
 *   - AC-02: a profile cannot exist without its membership — inserting an orphan
 *     profile (no matching membership) is refused by the DB (`23503`).
 *   - AC-05 (cascade half): removing a membership with NO history cascades the
 *     profile away — zero orphan rows. (The "membership WITH history is refused"
 *     half lands with #1261, once the historical appointment/agenda_block FKs are
 *     re-pointed to `member_id`.)
 *
 * Seeding runs over the superuser pool (bypassing RLS) so the fixtures exist; a
 * FK is enforced for owner and app role alike. The FK is DEFERRABLE INITIALLY
 * DEFERRED, so the orphan insert is only refused at COMMIT — the assertions key
 * on SQLSTATE `23503`, not a message string.
 */

const FK_VIOLATION = '23503'
const ORG = 'memops-org'
const USER = 'memops-user'

function pool() {
  return getEventStorePool()
}

function memberId(org: string, user: string): string {
  return `${org}_${user}`
}

async function seedOrg(): Promise<void> {
  await pool().query(
    `INSERT INTO orgs (org_id, id, last_event_version, name, slug, vertical, owner_user_id, branding, created_at, updated_at)
     VALUES ($1,$1,1,'Org','slug-'||$1,'barbershop','owner','{}'::jsonb,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`,
    [ORG],
  )
}

async function seedMembership(user = USER, role = 'professional'): Promise<void> {
  await pool().query(
    `INSERT INTO memberships (org_id, id, user_id, last_event_version, role, status, joined_at, permissions, updated_at)
     VALUES ($1, $1||'_'||$2, $2, 1, $3, 'active', '2026-01-01T00:00:00Z', '{}'::jsonb, '2026-01-01T00:00:00Z')`,
    [ORG, user, role],
  )
}

// Insert a professional profile hung off the membership `org_id||'_'||user`.
// `member_id` defaults to the matching membership key; pass an explicit
// `member` to force an orphan (no membership parent).
async function seedProfessional(id: string, user = USER, member?: string): Promise<void> {
  await pool().query(
    `INSERT INTO professionals (org_id, id, last_event_version, user_id, member_id, default_commission, unit_ids, catalog_service_ids, created_at, updated_at)
     VALUES ($1,$2,1,$3,$4,NULL,'[]'::jsonb,'[]'::jsonb,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`,
    [ORG, id, user, member ?? memberId(ORG, user)],
  )
}

describe('operational profile hangs off the membership (brief 0076 AC-02/AC-05)', () => {
  beforeEach(async () => {
    await pool().query('TRUNCATE events, projections, professionals, memberships, orgs CASCADE')
    await seedOrg()
  })

  afterAll(async () => {
    await closeEventStoreDb()
  })

  it('AC-02 — refuses an orphan profile with no matching membership (23503)', async () => {
    // No membership seeded for this member key — the FK has nothing to point at.
    await expect(seedProfessional('pro-orphan', USER, `${ORG}_ghost`)).rejects.toMatchObject({
      code: FK_VIOLATION,
    })
  })

  it('AC-02 — accepts a profile backed by a real membership', async () => {
    await seedMembership()
    await expect(seedProfessional('pro-1')).resolves.toBeUndefined()
    const { rows } = await pool().query<{ n: string }>(
      `SELECT count(*) AS n FROM professionals WHERE org_id = $1 AND id = 'pro-1'`,
      [ORG],
    )
    expect(Number(rows[0]?.n)).toBe(1)
  })

  it('AC-05 — removing a membership with no history cascades the profile away', async () => {
    await seedMembership()
    await seedProfessional('pro-1')
    // Sanity: the profile exists before the cascade.
    const before = await pool().query<{ n: string }>(
      `SELECT count(*) AS n FROM professionals WHERE org_id = $1`,
      [ORG],
    )
    expect(Number(before.rows[0]?.n)).toBe(1)

    await pool().query(`DELETE FROM memberships WHERE org_id = $1 AND id = $2`, [
      ORG,
      memberId(ORG, USER),
    ])

    // The profile is gone — no orphan row survives the membership removal.
    const after = await pool().query<{ n: string }>(
      `SELECT count(*) AS n FROM professionals WHERE org_id = $1`,
      [ORG],
    )
    expect(Number(after.rows[0]?.n)).toBe(0)
  })
})
