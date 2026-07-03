import { closeEventStoreDb, getEventStorePool } from '@/shared/db/pg/pool'
import { putUser } from '@/shared/db/pg/users-store'
import { buildUser } from '@/shared/fixtures/domain-builders'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { listActiveCustomersForOrg, listCustomersForOrg } from './customer-read'

/**
 * The active-customer reader against REAL Postgres. `listActiveCustomersForOrg`
 * is what the pickers (new appointment, new subscription) read, and it must drop
 * BOTH non-active states:
 *   - `archivedAt`    — LGPD block (brief 0032, AC-09/AC-11)
 *   - `deactivatedAt` — operator "Excluir cliente" (brief 0033, AC-07)
 * while `listCustomersForOrg` (the display/history map) keeps ALL of them so an
 * existing appointment/order still resolves the customer's name. This is the
 * customer-side analogue of the agenda memberOperation read-path invariant: the
 * picker offers only what can legitimately be selected now; history resolves the
 * rest. Per-run-unique org ids isolate each case.
 */

const TS = '2026-06-01T12:00:00.000Z'

let seq = 0
function uniqueOrg(): string {
  seq += 1
  return `actcust-${Date.now()}-${seq}`
}
function uid(prefix: string): string {
  seq += 1
  return `${prefix}-${Date.now()}-${seq}`
}

// `users_mobile_unique` is GLOBAL, so two seeded customers can't share a
// number. Derive a valid 13-digit BR mobile (55 + 11 + 9 + 8 digits) from the
// per-run-unique uid so every seeded user gets its own.
function uniqueMobile(seedUid: string): string {
  let hash = 0
  for (let i = 0; i < seedUid.length; i++) hash = (hash * 31 + seedUid.charCodeAt(i)) >>> 0
  return `55119${String(hash % 100_000_000).padStart(8, '0')}`
}

function pool() {
  return getEventStorePool()
}

async function seedOrg(orgId: string): Promise<void> {
  await pool().query(
    `INSERT INTO orgs (org_id, id, last_event_version, name, slug, vertical, owner_user_id, branding, created_at, updated_at)
     VALUES ($1,$1,1,'Org','slug-'||$1,'barbershop','owner','{}'::jsonb,$2,$2)
     ON CONFLICT (org_id) DO NOTHING`,
    [orgId, TS],
  )
}

// Seeds a customer shadow with the linked global user (so enrich resolves a
// name). `archivedAt`/`deactivatedAt` set the non-active states. Returns the id.
async function seedCustomer(
  orgId: string,
  opts: { name: string; archivedAt?: string | null; deactivatedAt?: string | null } = {
    name: 'Cliente',
  },
): Promise<string> {
  await seedOrg(orgId)
  const userId = uid('user')
  await putUser(buildUser(userId, TS, { displayName: opts.name, mobile: uniqueMobile(userId) }))
  const id = uid('cust')
  await pool().query(
    `INSERT INTO customers (org_id, id, last_event_version, user_id, archived_at, deactivated_at, created_at, updated_at)
     VALUES ($1,$2,1,$3,$4,$5,$6,$6)`,
    [orgId, id, userId, opts.archivedAt ?? null, opts.deactivatedAt ?? null, TS],
  )
  return id
}

describe('listActiveCustomersForOrg (picker read) vs listCustomersForOrg (history)', () => {
  beforeEach(async () => {
    await pool().query('TRUNCATE events, projections, customers, orgs, users CASCADE')
  })
  afterAll(async () => {
    await closeEventStoreDb()
  })

  it('active read returns only the non-archived, non-deactivated customer', async () => {
    const t = uniqueOrg()
    const active = await seedCustomer(t, { name: 'Ativa' })
    await seedCustomer(t, { name: 'Bloqueada', archivedAt: TS })
    await seedCustomer(t, { name: 'Excluída', deactivatedAt: TS })
    const ids = (await listActiveCustomersForOrg(t)).map((c) => c.id)
    expect(ids).toEqual([active])
  })

  it('history read keeps ALL three states (so existing records resolve the name)', async () => {
    const t = uniqueOrg()
    await seedCustomer(t, { name: 'Ativa' })
    await seedCustomer(t, { name: 'Bloqueada', archivedAt: TS })
    await seedCustomer(t, { name: 'Excluída', deactivatedAt: TS })
    expect((await listCustomersForOrg(t)).length).toBe(3)
  })

  it('a deactivated customer is excluded from the picker but still in history', async () => {
    const t = uniqueOrg()
    const removed = await seedCustomer(t, { name: 'Removida', deactivatedAt: TS })
    expect((await listActiveCustomersForOrg(t)).map((c) => c.id)).not.toContain(removed)
    expect((await listCustomersForOrg(t)).map((c) => c.id)).toContain(removed)
  })
})
