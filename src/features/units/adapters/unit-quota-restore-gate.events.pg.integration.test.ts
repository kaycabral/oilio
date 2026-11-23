import { closeEventStoreDb, getEventStorePool } from '@/shared/db/pg/pool'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { assertActiveUnitQuota } from './units-quota'

const TS = '2026-06-01T12:00:00.000Z'
let seq = 0
function uniqOrg(): string {
  seq += 1
  return `uq-${Date.now()}-${seq}`
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

async function seedTier(orgId: string, tier: 'pro' | 'advanced'): Promise<void> {
  await pool().query(
    `INSERT INTO org_billing (org_id, id, last_event_version, tier, status, created_at, updated_at)
     VALUES ($1,$1,1,$2,'active',$3,$3)
     ON CONFLICT (org_id) DO UPDATE SET tier = EXCLUDED.tier`,
    [orgId, tier, TS],
  )
}

const ADDRESS_JSON =
  '{"postalCode":"01310100","state":"SP","city":"São Paulo","neighborhood":"Bela Vista","street":"Avenida Paulista","number":"1000","complement":null}'

async function seedUnit(orgId: string, unitId: string, archived: boolean): Promise<void> {
  await pool().query(
    `INSERT INTO units (org_id, id, last_event_version, name, slug, timezone, agenda_mode, fiscal_kind, address, agenda, fiscal, archived_at, created_at, updated_at)
     VALUES ($1,$2,1,'Unit','unit-'||$2,'America/Sao_Paulo','always_open','informal',$3::jsonb,'{"mode":"always_open"}'::jsonb,'{"kind":"informal"}'::jsonb,$4,$5,$5)
     ON CONFLICT (org_id, id) DO NOTHING`,
    [orgId, unitId, ADDRESS_JSON, archived ? TS : null, TS],
  )
}

describe('assertActiveUnitQuota — restore gate (brief 0088 H1)', () => {
  beforeEach(async () => {
    await pool().query("DELETE FROM units WHERE org_id LIKE 'uq-%'")
    await pool().query("DELETE FROM org_billing WHERE org_id LIKE 'uq-%'")
    await pool().query("DELETE FROM orgs WHERE org_id LIKE 'uq-%'")
  })

  afterAll(async () => {
    await closeEventStoreDb()
  })

  it('Free com 1 unidade ativa: recusa a 2ª (o path de restore reusa esta parede)', async () => {
    const orgId = uniqOrg()
    await seedOrg(orgId)
    await seedUnit(orgId, `${orgId}-a`, false)

    const err = await assertActiveUnitQuota(orgId)
    expect(err).toContain('plano Grátis permite 1 unidade')
  })

  it('Free com 1 unidade ARQUIVADA residual: restore permitido (arquivada não conta)', async () => {
    const orgId = uniqOrg()
    await seedOrg(orgId)
    await seedUnit(orgId, `${orgId}-arch`, true)

    const err = await assertActiveUnitQuota(orgId)
    expect(err).toBeNull()
  })

  it('Pro com 1 unidade ativa: permite a 2ª (units.unlimited)', async () => {
    const orgId = uniqOrg()
    await seedOrg(orgId)
    await seedTier(orgId, 'pro')
    await seedUnit(orgId, `${orgId}-a`, false)

    const err = await assertActiveUnitQuota(orgId)
    expect(err).toBeNull()
  })
})
