import { Client } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { closeEventStoreDb, getEventStorePool } from '../pool'

/**
 * RLS isolation proof for `message_templates` (migration feature F — cutover,
 * brief 0062, AC-03). The notification message library is an org-only config
 * table: the policy filters `org_id = current_setting('app.current_org')` on both
 * USING (read) and WITH CHECK (write).
 *
 * Mirrors `config-rls-isolation.events.pg.integration.test.ts`: the ephemeral
 * Postgres connects as superuser (which bypasses RLS), so every isolation
 * assertion runs through a NON-superuser role (`oilio_rls_app`, no BYPASSRLS —
 * the production runtime shape). Seeding happens over the superuser pool so the
 * fixtures exist regardless of policy.
 */

const APP_ROLE = 'oilio_rls_app'
const APP_PASSWORD = 'rls_test'

const ORG_A = 'org-a'
const ORG_B = 'org-b'

let appUrl: string

async function seedOrg(id: string): Promise<void> {
  await getEventStorePool().query(
    `INSERT INTO orgs (org_id, id, last_event_version, name, slug, vertical, owner_user_id, branding, created_at, updated_at)
     VALUES ($1,$1,1,'Org','slug-'||$1,'barbershop','owner','{}'::jsonb,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`,
    [id],
  )
}

async function seedTemplate(orgId: string, type: string): Promise<void> {
  await getEventStorePool().query(
    `INSERT INTO message_templates (org_id, type, body, enabled, last_actor_uid, updated_at)
     VALUES ($1,$2,'Olá!',true,'owner','2026-01-01T00:00:00Z')`,
    [orgId, type],
  )
}

// A fresh connection AS the non-superuser app role, with `app.current_org` set.
async function appClient(orgId: string): Promise<Client> {
  const c = new Client({ connectionString: appUrl })
  await c.connect()
  await c.query('SELECT set_config($1, $2, false)', ['app.current_org', orgId])
  return c
}

describe('Postgres RLS isolation — message_templates (brief 0062, AC-03)', () => {
  beforeAll(async () => {
    const pool = getEventStorePool()
    await pool.query(`DROP OWNED BY ${APP_ROLE}`).catch(() => undefined)
    await pool.query(`DROP ROLE IF EXISTS ${APP_ROLE}`).catch(() => undefined)
    await pool.query(`CREATE ROLE ${APP_ROLE} LOGIN PASSWORD '${APP_PASSWORD}' NOBYPASSRLS`)
    await pool.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON orgs, message_templates TO ${APP_ROLE}`,
    )
    const base = process.env.OILIO_DATABASE_URL
    if (!base) throw new Error('OILIO_DATABASE_URL is required for the RLS isolation proof')
    appUrl = base.replace(/\/\/[^@]+@/, `//${APP_ROLE}:${APP_PASSWORD}@`)
  })

  beforeEach(async () => {
    await getEventStorePool().query('TRUNCATE message_templates, orgs CASCADE')
  })

  afterAll(async () => {
    const pool = getEventStorePool()
    await pool.query(`DROP OWNED BY ${APP_ROLE}`).catch(() => undefined)
    await pool.query(`DROP ROLE IF EXISTS ${APP_ROLE}`).catch(() => undefined)
    await closeEventStoreDb()
  })

  it('a session scoped to org A reads ZERO rows of org B (read isolation)', async () => {
    await seedOrg(ORG_A)
    await seedOrg(ORG_B)
    await seedTemplate(ORG_A, 'birthday')
    await seedTemplate(ORG_B, 'birthday')

    const a = await appClient(ORG_A)
    try {
      const all = await a.query<{ org_id: string }>('SELECT org_id FROM message_templates')
      expect(all.rows).toHaveLength(1)
      expect(all.rows[0]?.org_id).toBe(ORG_A)
    } finally {
      await a.end()
    }
  })

  it('a session scoped to org A CANNOT INSERT a template for org B (WITH CHECK)', async () => {
    await seedOrg(ORG_A)
    await seedOrg(ORG_B)

    const a = await appClient(ORG_A)
    try {
      await expect(
        a.query(
          `INSERT INTO message_templates (org_id, type, body, enabled, updated_at)
           VALUES ($1,'birthday','x',true,'2026-01-01T00:00:00Z')`,
          [ORG_B],
        ),
        // 42501 = insufficient_privilege (RLS WITH CHECK violation)
      ).rejects.toMatchObject({ code: '42501' })
    } finally {
      await a.end()
    }
  })

  it('a session with NO org context (GUC unset) sees zero rows (fail-closed)', async () => {
    await seedOrg(ORG_A)
    await seedTemplate(ORG_A, 'birthday')

    const c = new Client({ connectionString: appUrl })
    await c.connect()
    try {
      const visible = await c.query('SELECT org_id FROM message_templates')
      expect(visible.rows).toHaveLength(0)
    } finally {
      await c.end()
    }
  })
})
