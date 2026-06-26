import { isLinkedToOrg, linkCustomerOrg, listLinkedOrgIds } from '@/shared/identity/org-links'
import { Client } from 'pg'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { closeEventStoreDb, getEventStorePool } from '../db/pg/pool'

/**
 * PER-SUBJECT RLS proof for the identity reverse index `org_links` against REAL
 * Postgres (cutover, brief 0062 — the rewrite of the Firestore-emulator
 * `org-links.integration.test.ts`). Migration 0012 puts `org_links` under
 * `FORCE ROW LEVEL SECURITY` with a per-subject policy
 * (`user_id = current_setting('app.current_user_id')`): a subject reads/writes
 * ONLY their own links ("where am I a customer?"). This proves the DATABASE
 * refuses cross-subject access — the per-subject analogue of the org-scoped
 * `rls-isolation.events.pg.integration.test.ts`.
 *
 * Two layers are proven:
 *   1. The DB policy directly, through a NON-superuser role (`oilio_links_app`,
 *      no BYPASSRLS — the production runtime shape) with `app.current_user_id`
 *      set per connection. The ephemeral Postgres connects as superuser, which
 *      bypasses RLS, so a proof over the superuser pool would be vacuous.
 *   2. The production helpers (`linkCustomerOrg` / `listLinkedOrgIds` /
 *      `isLinkedToOrg`) — idempotency of the link + per-subject reads. These run
 *      over the superuser pool (they set `app.current_user_id` themselves via
 *      `readAsSubject`), so they exercise the helper logic, not the policy.
 *
 * Seeding happens over the superuser pool (bypassing RLS) so fixtures exist
 * regardless of policy. OILIO_DATABASE_URL is set by the events-IT runner.
 */

const APP_ROLE = 'oilio_links_app'
const APP_PASSWORD = 'rls_test'

const USER_A = 'subject-a'
const USER_B = 'subject-b'
const ORG_A1 = 'org-a1'
const ORG_A2 = 'org-a2'
const ORG_B1 = 'org-b1'

let appUrl: string

async function seedLink(userId: string, orgId: string): Promise<void> {
  await getEventStorePool().query(
    `INSERT INTO org_links (user_id, org_id, linked_at) VALUES ($1, $2, $3)
     ON CONFLICT (user_id, org_id) DO NOTHING`,
    [userId, orgId, '2026-06-01T12:00:00.000Z'],
  )
}

// A fresh connection AS the non-superuser app role, with the per-subject GUC set
// for the subject under test.
async function subjectClient(userId: string): Promise<Client> {
  const c = new Client({ connectionString: appUrl })
  await c.connect()
  await c.query('SELECT set_config($1, $2, false)', ['app.current_user_id', userId])
  return c
}

describe('Postgres RLS isolation — org_links per-subject (brief 0062)', () => {
  beforeAll(async () => {
    const pool = getEventStorePool()
    await pool.query(`DROP OWNED BY ${APP_ROLE}`).catch(() => undefined)
    await pool.query(`DROP ROLE IF EXISTS ${APP_ROLE}`).catch(() => undefined)
    await pool.query(`CREATE ROLE ${APP_ROLE} LOGIN PASSWORD '${APP_PASSWORD}' NOBYPASSRLS`)
    await pool.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON org_links TO ${APP_ROLE}`)
    const base = process.env.OILIO_DATABASE_URL
    if (!base) throw new Error('OILIO_DATABASE_URL is required for the RLS isolation proof')
    appUrl = base.replace(/\/\/[^@]+@/, `//${APP_ROLE}:${APP_PASSWORD}@`)
  })

  beforeEach(async () => {
    await getEventStorePool().query('TRUNCATE org_links')
  })

  afterAll(async () => {
    const pool = getEventStorePool()
    await pool.query(`DROP OWNED BY ${APP_ROLE}`).catch(() => undefined)
    await pool.query(`DROP ROLE IF EXISTS ${APP_ROLE}`).catch(() => undefined)
    await closeEventStoreDb()
  })

  it('a subject reads ONLY their own links — user A never sees user B (read isolation)', async () => {
    await seedLink(USER_A, ORG_A1)
    await seedLink(USER_A, ORG_A2)
    await seedLink(USER_B, ORG_B1)

    const a = await subjectClient(USER_A)
    try {
      const seen = await a.query<{ org_id: string }>('SELECT org_id FROM org_links ORDER BY org_id')
      expect(seen.rows.map((r) => r.org_id)).toEqual([ORG_A1, ORG_A2])
    } finally {
      await a.end()
    }
  })

  it('a subject CANNOT write a link for another subject (WITH CHECK)', async () => {
    const a = await subjectClient(USER_A)
    try {
      await expect(
        a.query(
          `INSERT INTO org_links (user_id, org_id, linked_at) VALUES ($1, $2, '2026-01-01T00:00:00Z')`,
          [USER_B, ORG_B1],
        ),
        // 42501 = insufficient_privilege (RLS WITH CHECK violation)
      ).rejects.toMatchObject({ code: '42501' })
    } finally {
      await a.end()
    }
  })

  it('a session with NO subject context (GUC unset) sees zero rows (fail-closed)', async () => {
    await seedLink(USER_A, ORG_A1)

    const c = new Client({ connectionString: appUrl })
    await c.connect()
    try {
      const visible = await c.query('SELECT org_id FROM org_links')
      expect(visible.rows).toHaveLength(0)
    } finally {
      await c.end()
    }
  })
})

describe('org-links helpers — idempotency + per-subject reads', () => {
  afterEach(async () => {
    await getEventStorePool().query('TRUNCATE org_links')
  })
  afterAll(async () => {
    await closeEventStoreDb()
  })

  it('linkCustomerOrg writes one row and is idempotent (never duplicates / rewrites linked_at)', async () => {
    await linkCustomerOrg(USER_A, ORG_A1)
    const first = await getEventStorePool().query<{ linked_at: string }>(
      'SELECT linked_at FROM org_links WHERE user_id = $1 AND org_id = $2',
      [USER_A, ORG_A1],
    )
    expect(first.rowCount).toBe(1)
    // `linked_at` is `timestamptz` (brief 0068 D1): the pg driver returns a
    // `Date`, so normalize to ISO before the shape assertion.
    const firstLinkedAt = new Date(first.rows[0]!.linked_at).toISOString()
    expect(firstLinkedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)

    // Re-linking the same pair is a no-op — ON CONFLICT DO NOTHING keeps the row.
    await linkCustomerOrg(USER_A, ORG_A1)
    const second = await getEventStorePool().query<{ linked_at: string }>(
      'SELECT linked_at FROM org_links WHERE user_id = $1',
      [USER_A],
    )
    expect(second.rowCount).toBe(1)
    // Same raw-read normalization as `firstLinkedAt` (the pg driver returns a
    // `Date` for the `timestamptz` column): compare ISO-to-ISO.
    const secondLinkedAt =
      second.rows[0] == null ? null : new Date(second.rows[0].linked_at).toISOString()
    expect(secondLinkedAt).toBe(firstLinkedAt)
  })

  it('linkCustomerOrg is a no-op for an empty userId / orgId', async () => {
    await linkCustomerOrg('', ORG_A1)
    await linkCustomerOrg(USER_A, '')
    const res = await getEventStorePool().query('SELECT 1 FROM org_links')
    expect(res.rowCount).toBe(0)
  })

  it('listLinkedOrgIds / isLinkedToOrg read ONLY the subject own index', async () => {
    await linkCustomerOrg(USER_A, ORG_A1)
    await linkCustomerOrg(USER_A, ORG_A2)
    await linkCustomerOrg(USER_B, ORG_B1)

    const linked = await listLinkedOrgIds(USER_A)
    expect(linked.sort()).toEqual([ORG_A1, ORG_A2].sort())
    // The other subject's link is NOT visible — per-subject scope.
    expect(linked).not.toContain(ORG_B1)

    expect(await isLinkedToOrg(USER_A, ORG_A1)).toBe(true)
    expect(await isLinkedToOrg(USER_A, ORG_B1)).toBe(false)
    expect(await listLinkedOrgIds('nobody')).toEqual([])
    expect(await listLinkedOrgIds('')).toEqual([])
  })
})
