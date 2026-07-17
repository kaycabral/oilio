#!/usr/bin/env node
// Read-only production inspection entrypoint for the oilio event store + typed
// projections. Runs as an ephemeral Cloud Run Job over the SAME image, VPC egress
// and IAM identity (`oilio-migrator@`, which holds SELECT) as the migrator — no
// new infra, no writes. Reuses the migrator's connection policy verbatim.
//
// SAFETY: this script issues SELECT only. It never mutates. A statement guard
// rejects any non-SELECT/WITH query before it reaches the pool, and the session
// runs as READ ONLY so the database itself refuses writes as defense-in-depth.
//
// Usage (override the migrate image entrypoint):
//   gcloud run jobs execute oilio-migrate-event-store --region us-east4 \
//     --update-env-vars INSPECT_CHECK=discover \
//     --args=apps/oilio/web/scripts/inspect-prod-event-store.mjs --wait
// Optional: INSPECT_ORG=<org_id> scopes org-specific checks. INSPECT_CHECK=all
// runs the full catalog.

import { Pool } from 'pg'

function requireEnv(name) {
  const v = process.env[name]
  if (typeof v !== 'string' || v === '') {
    console.error(`Missing required env: ${name}`)
    process.exit(1)
  }
  return v
}

async function buildPool() {
  if (process.env.OILIO_USE_IAM_AUTH === 'true') {
    const { Connector, AuthTypes, IpAddressTypes } =
      await import('@google-cloud/cloud-sql-connector')
    const connector = new Connector()
    const clientOpts = await connector.getOptions({
      instanceConnectionName: requireEnv('OILIO_CLOUDSQL_INSTANCE'),
      authType: AuthTypes.IAM,
      ipType: IpAddressTypes.PRIVATE,
    })
    const pool = new Pool({
      ...clientOpts,
      user: requireEnv('OILIO_IAM_DB_USER'),
      database: 'oilio',
      max: 1,
    })
    return {
      pool,
      close: async () => {
        await pool.end()
        connector.close()
      },
    }
  }
  const pool = new Pool({ connectionString: requireEnv('OILIO_DATABASE_URL'), max: 1 })
  return { pool, close: () => pool.end() }
}

// Guard: only read statements reach the DB. Blocks anything that isn't a bare
// SELECT/WITH (defense against a fat-fingered mutation in the catalog).
function assertReadOnly(sql) {
  const head = sql.trim().replace(/^\(+/, '').toLowerCase()
  if (!head.startsWith('select') && !head.startsWith('with')) {
    throw new Error(`Refusing non-read statement: ${sql.slice(0, 60)}...`)
  }
}

const org = process.env.INSPECT_ORG ?? null

// Catalog of named health checks. Each returns { sql, params }.
const CHECKS = {
  // What orgs / users exist at all — the first thing to run on a fresh deploy.
  discover: [
    {
      label: 'orgs',
      sql: `SELECT org_id, name, slug, vertical, owner_user_id, created_at
            FROM orgs ORDER BY created_at`,
    },
    { label: 'user_count', sql: `SELECT count(*)::int AS users FROM users` },
    {
      label: 'membership_count_by_org',
      sql: `SELECT org_id, count(*)::int AS members FROM memberships GROUP BY org_id ORDER BY org_id`,
    },
  ],

  // Event stream health: volume, span, and shape by aggregate.
  'events-timeline': [
    {
      label: 'event_totals',
      sql: `SELECT count(*)::int AS total,
                   min(created_at) AS first_event,
                   max(created_at) AS last_event
            FROM events`,
    },
    {
      label: 'events_by_type',
      sql: `SELECT aggregate_type, count(*)::int AS n, max(version) AS max_version
            FROM events GROUP BY aggregate_type ORDER BY n DESC`,
    },
    {
      label: 'events_last_20',
      sql: `SELECT id, aggregate_type, aggregate_id, version, org_id, created_at
            FROM events ORDER BY id DESC LIMIT 20`,
    },
  ],

  // Event-store integrity: version gaps break replay; the UNIQUE already blocks
  // duplicates, but a gap (missing v2 between v1 and v3) is a silent corruption.
  integrity: [
    {
      label: 'version_gaps',
      sql: `WITH seq AS (
              SELECT aggregate_type, org_id, aggregate_id, version,
                     lag(version) OVER (
                       PARTITION BY aggregate_type, org_id, aggregate_id
                       ORDER BY version) AS prev
              FROM events)
            SELECT aggregate_type, org_id, aggregate_id, prev, version
            FROM seq
            WHERE prev IS NOT NULL AND version <> prev + 1
            ORDER BY aggregate_type, aggregate_id`,
    },
    {
      label: 'projection_version_drift',
      sql: `SELECT o.org_id, o.name, o.last_event_version,
                   (SELECT max(e.version) FROM events e
                    WHERE e.aggregate_type = 'org' AND e.aggregate_id = o.org_id) AS max_org_event
            FROM orgs o ORDER BY o.org_id`,
    },
  ],

  // Business projections: is the org actually operating?
  'org-health': [
    {
      label: 'catalog_items',
      sql: `SELECT org_id, count(*)::int AS items FROM "catalog-items"
            ${org ? 'WHERE org_id = $1' : ''} GROUP BY org_id ORDER BY org_id`,
      params: org ? [org] : [],
    },
    {
      label: 'units',
      sql: `SELECT org_id, count(*)::int AS units FROM units
            ${org ? 'WHERE org_id = $1' : ''} GROUP BY org_id ORDER BY org_id`,
      params: org ? [org] : [],
    },
    {
      label: 'subscription_plans',
      sql: `SELECT org_id, count(*)::int AS plans FROM subscription_plans
            ${org ? 'WHERE org_id = $1' : ''} GROUP BY org_id ORDER BY org_id`,
      params: org ? [org] : [],
    },
  ],

  // The money path — orders, commissions, charges, cash.
  orders: [
    {
      label: 'orders_summary',
      sql: `SELECT org_id, count(*)::int AS n, min(created_at) AS first, max(created_at) AS last
            FROM orders ${org ? 'WHERE org_id = $1' : ''} GROUP BY org_id ORDER BY org_id`,
      params: org ? [org] : [],
    },
    {
      label: 'commissions_summary',
      sql: `SELECT org_id, count(*)::int AS n FROM commissions
            ${org ? 'WHERE org_id = $1' : ''} GROUP BY org_id ORDER BY org_id`,
      params: org ? [org] : [],
    },
    {
      label: 'charges_summary',
      sql: `SELECT org_id, count(*)::int AS n FROM charges
            ${org ? 'WHERE org_id = $1' : ''} GROUP BY org_id ORDER BY org_id`,
      params: org ? [org] : [],
    },
    {
      label: 'cash_movements_summary',
      sql: `SELECT org_id, count(*)::int AS n FROM "cash-movements"
            ${org ? 'WHERE org_id = $1' : ''} GROUP BY org_id ORDER BY org_id`,
      params: org ? [org] : [],
    },
  ],

  // Subscriptions + billing (the SaaS monetization layer).
  billing: [
    {
      label: 'org_billing',
      sql: `SELECT org_id, count(*)::int AS n FROM org_billing
            ${org ? 'WHERE org_id = $1' : ''} GROUP BY org_id ORDER BY org_id`,
      params: org ? [org] : [],
    },
    {
      label: 'subscriptions',
      sql: `SELECT org_id, count(*)::int AS n FROM subscriptions
            ${org ? 'WHERE org_id = $1' : ''} GROUP BY org_id ORDER BY org_id`,
      params: org ? [org] : [],
    },
  ],

  // #1420: does the subscription creation date (created_at, i.e. the write
  // timestamp) diverge from the accrual competence (the first charge's
  // period_start_at, i.e. the chosen "Início da vigência")? A non-zero
  // `gap_days` on any row proves a retroactive subscription exists in prod and
  // sizes the backfill. Read-only: joins subscriptions to its earliest charge.
  'subscription-competence': [
    {
      label: 'subscription_dates',
      sql: `SELECT s.org_id,
                   s.id,
                   s.status,
                   s.created_at,
                   (s.current_period->>'startAt') AS current_period_start,
                   fc.first_period_start_at,
                   fc.charge_count,
                   round(EXTRACT(EPOCH FROM (
                     date_trunc('day', s.created_at)
                     - date_trunc('day', fc.first_period_start_at)
                   )) / 86400)::int AS gap_days
            FROM subscriptions s
            LEFT JOIN LATERAL (
              SELECT min(c.period_start_at) AS first_period_start_at,
                     count(*)::int AS charge_count
              FROM charges c
              WHERE c.org_id = s.org_id AND c.subscription_id = s.id
            ) fc ON true
            ${org ? 'WHERE s.org_id = $1' : ''}
            ORDER BY s.org_id, s.created_at`,
      params: org ? [org] : [],
    },
    {
      label: 'retroactive_count',
      sql: `WITH sub_first AS (
              SELECT s.org_id, s.id, s.created_at,
                     (SELECT min(c.period_start_at) FROM charges c
                      WHERE c.org_id = s.org_id AND c.subscription_id = s.id
                     ) AS first_period_start_at
              FROM subscriptions s
              ${org ? 'WHERE s.org_id = $1' : ''}
            )
            SELECT count(*)::int AS total_subscriptions,
                   count(*) FILTER (
                     WHERE date_trunc('day', created_at)
                         <> date_trunc('day', first_period_start_at)
                   )::int AS retroactive_subscriptions
            FROM sub_first`,
      params: org ? [org] : [],
    },
  ],
}

async function run() {
  const rawCheck = process.env.INSPECT_CHECK ?? null
  const which = rawCheck === null || rawCheck === '' ? 'discover' : rawCheck
  const names = which === 'all' ? Object.keys(CHECKS) : [which]
  const unknown = names.filter((n) => !CHECKS[n])
  if (unknown.length) {
    console.error(`Unknown check(s): ${unknown.join(', ')}`)
    console.error(`Available: ${Object.keys(CHECKS).join(', ')}, all`)
    process.exit(1)
  }

  const { pool, close } = await buildPool()
  const client = await pool.connect()
  try {
    await client.query('SET default_transaction_read_only = on')
    await client.query('SET statement_timeout = 30000')
    for (const name of names) {
      console.log(`\n===== CHECK: ${name}${org ? ` (org=${org})` : ''} =====`)
      for (const q of CHECKS[name]) {
        assertReadOnly(q.sql)
        try {
          const res = await client.query(q.sql, q.params ?? [])
          console.log(`--- ${q.label} (${res.rowCount} rows) ---`)
          console.log(JSON.stringify(res.rows, null, 2))
        } catch (err) {
          console.error(`✕ ${q.label} failed:`, err.message)
        }
      }
    }
  } finally {
    client.release()
    await close()
  }
}

await run()
