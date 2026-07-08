import { Client } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { closeEventStoreDb, getEventStorePool } from '../pool'

/**
 * SONDA (não é gate — é prova de risco pra a decisão de RLS na tabela `events`,
 * brief 0091 / ADR 0016 D4). Antes de habilitar RLS na `events`, precisamos saber
 * empiricamente: sob `FORCE ROW LEVEL SECURITY` + policy `org_id`, como se comporta
 * o caminho de REPLAY, que lê `SELECT ... FROM events WHERE aggregate_type/org_id/
 * aggregate_id` SEM setar o GUC `app.current_org` (getEvents em postgres-layer.ts
 * faz `pool.connect()` direto, fora de `readUnderRls`)?
 *
 * O role de produção é NON-superuser sem BYPASSRLS (confirmado por
 * rls-isolation.events.pg.integration.test.ts). Se o replay não seta o GUC, a
 * policy `org_id = current_setting('app.current_org', true)` compara com string
 * vazia/null → ZERO linhas → replay quebra a reconstrução de TODO aggregate.
 *
 * Este teste roda como o role NOBYPASSRLS (a forma de produção) e mede os dois
 * caminhos. Resultado: SEM GUC → zero linhas → RLS quebraria o replay. Por isso a
 * RLS na `events` foi ADIADA (issue #1384: migrar o replay pra `readUnderRls`
 * primeiro); o `readOrgEventStream` scopa por `WHERE org_id` como o replay já faz.
 * Esta sonda documenta o porquê e guarda contra um enable prematuro.
 */

const APP_ROLE = 'oilio_rls_probe'
const APP_PASSWORD = 'rls_probe'
const ORG_A = 'probe-org-a'
const ORG_B = 'probe-org-b'

let appUrl: string

async function seedEvent(orgId: string, aggregateId: string): Promise<void> {
  await getEventStorePool().query(
    `INSERT INTO events (aggregate_type, aggregate_id, version, org_id, envelope, occurred_at)
     VALUES ('order', $2, 1, $1, $3::jsonb, '2026-05-01T12:00:00Z')`,
    [
      orgId,
      aggregateId,
      JSON.stringify({
        _tag: 'order.created',
        version: 1,
        timestamp: '2026-05-01T12:00:00Z',
        actorId: 'u',
        schemaVersion: 2,
        payload: {},
      }),
    ],
  )
}

// Connection AS the non-superuser role. `withOrg` mirrors what runTransaction
// injects (SET the org GUC); `withoutOrg` mirrors the replay path (no GUC).
async function connect(): Promise<Client> {
  const c = new Client({ connectionString: appUrl })
  await c.connect()
  return c
}

describe('SONDA: RLS na events vs. caminho de replay (sem GUC)', () => {
  beforeAll(async () => {
    const pool = getEventStorePool()
    await pool.query(`DROP OWNED BY ${APP_ROLE}`).catch(() => undefined)
    await pool.query(`DROP ROLE IF EXISTS ${APP_ROLE}`).catch(() => undefined)
    await pool.query(`CREATE ROLE ${APP_ROLE} LOGIN PASSWORD '${APP_PASSWORD}' NOBYPASSRLS`)
    await pool.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON events TO ${APP_ROLE}`)
    // RLS is NOT enabled on `events` by the migration (we deferred it — see the
    // schema comment). This probe applies FORCE RLS + the org policy LOCALLY, only
    // for the duration of this spec, to prove empirically what WOULD happen if it
    // were enabled — so the finding is reproducible and guards a future attempt.
    await pool.query(`ALTER TABLE events ENABLE ROW LEVEL SECURITY`)
    await pool.query(`ALTER TABLE events FORCE ROW LEVEL SECURITY`)
    await pool.query(
      `CREATE POLICY events_org_isolation_probe ON events USING (org_id = current_setting('app.current_org', true))`,
    )
    const base = process.env.OILIO_DATABASE_URL
    if (!base) throw new Error('OILIO_DATABASE_URL required')
    appUrl = base.replace(/\/\/[^@]+@/, `//${APP_ROLE}:${APP_PASSWORD}@`)
  })

  beforeEach(async () => {
    await getEventStorePool().query(`DELETE FROM events WHERE org_id IN ($1,$2)`, [ORG_A, ORG_B])
  })

  afterAll(async () => {
    const pool = getEventStorePool()
    // Undo the LOCAL policy/RLS this probe applied (it is not part of the schema).
    await pool
      .query(`DROP POLICY IF EXISTS events_org_isolation_probe ON events`)
      .catch(() => undefined)
    await pool.query(`ALTER TABLE events NO FORCE ROW LEVEL SECURITY`).catch(() => undefined)
    await pool.query(`ALTER TABLE events DISABLE ROW LEVEL SECURITY`).catch(() => undefined)
    await pool.query(`DROP OWNED BY ${APP_ROLE}`).catch(() => undefined)
    await pool.query(`DROP ROLE IF EXISTS ${APP_ROLE}`).catch(() => undefined)
    await closeEventStoreDb()
  })

  it('WITH org GUC set: reads only its org (isolation holds — AC-07)', async () => {
    await seedEvent(ORG_A, 'a1')
    await seedEvent(ORG_B, 'b1')
    const c = await connect()
    try {
      await c.query('SELECT set_config($1, $2, false)', ['app.current_org', ORG_A])
      const res = await c.query<{ org_id: string }>('SELECT org_id FROM events')
      expect(res.rows).toHaveLength(1)
      expect(res.rows[0]?.org_id).toBe(ORG_A)
    } finally {
      await c.end()
    }
  })

  it('WITHOUT org GUC (the replay path): reads ZERO — RLS would break replay', async () => {
    await seedEvent(ORG_A, 'a1')
    const c = await connect()
    try {
      // Exactly what getEvents/readEventStream does today: filter by org_id in the
      // query, no `app.current_org` GUC set.
      const res = await c.query(
        `SELECT envelope FROM events WHERE aggregate_type='order' AND org_id=$1 AND aggregate_id='a1' ORDER BY version`,
        [ORG_A],
      )
      // This assertion documents the finding. If it reads 0, FORCE RLS breaks the
      // replay path unless getEvents is migrated to run under readUnderRls.
      expect(res.rows).toHaveLength(0)
    } finally {
      await c.end()
    }
  })
})
