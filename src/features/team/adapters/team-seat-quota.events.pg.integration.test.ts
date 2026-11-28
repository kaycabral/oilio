import { defaultPermissionsForRole } from '@/domain'
import { closeEventStoreDb } from '@/shared/db/pg/pool'
import { ownerPool } from '@/shared/db/pg/test/owner-pool'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { assertTeamSeatQuota } from './team-quota'

const TS = '2026-06-01T12:00:00.000Z'
const FUTURE = '2999-01-01T00:00:00.000Z'
const PAST = '2020-01-01T00:00:00.000Z'
let seq = 0
function uniqOrg(): string {
  seq += 1
  return `tq-${Date.now()}-${seq}`
}

function pool() {
  return ownerPool()
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

const PERMS = JSON.stringify(defaultPermissionsForRole('owner'))

async function seedMember(
  orgId: string,
  userId: string,
  status: 'active' | 'revoked' = 'active',
): Promise<void> {
  await pool().query(
    `INSERT INTO memberships (org_id, id, user_id, last_event_version, role, status, joined_at, permissions, updated_at)
     VALUES ($1, $1||'_'||$2, $2, 1, 'owner', $3, $4, $5::jsonb, $4)
     ON CONFLICT (org_id, id) DO NOTHING`,
    [orgId, userId, status, TS, PERMS],
  )
}

async function seedInvite(
  orgId: string,
  inviteId: string,
  opts: { status?: 'pending' | 'revoked'; expiresAt?: string } = {},
): Promise<void> {
  const status = opts.status ?? 'pending'
  const expiresAt = opts.expiresAt ?? FUTURE
  await pool().query(
    `INSERT INTO invites (org_id, id, last_event_version, role, token_hash, expires_at, status, invited_by, accepted_by_uid, accepted_at, created_at, updated_at)
     VALUES ($1, $2, 1, 'member_operator', 'hash-'||$2, $3, $4, 'owner', NULL, NULL, $5, $5)
     ON CONFLICT (org_id, id) DO NOTHING`,
    [orgId, inviteId, expiresAt, status, TS],
  )
}

describe('assertTeamSeatQuota — Free "você + 1" cap (brief 0089)', () => {
  beforeEach(async () => {
    await pool().query("DELETE FROM invites WHERE org_id LIKE 'tq-%'")
    await pool().query("DELETE FROM memberships WHERE org_id LIKE 'tq-%'")
    await pool().query("DELETE FROM org_billing WHERE org_id LIKE 'tq-%'")
    await pool().query("DELETE FROM orgs WHERE org_id LIKE 'tq-%'")
  })

  afterAll(async () => {
    await closeEventStoreDb()
  })

  it('Free com só o dono (1 seat): permite convidar o +1', async () => {
    const orgId = uniqOrg()
    await seedOrg(orgId)
    await seedMember(orgId, 'owner')

    expect(await assertTeamSeatQuota(orgId)).toBeNull()
  })

  it('Free com dono + 1 membro (2 seats): barra o 3º', async () => {
    const orgId = uniqOrg()
    await seedOrg(orgId)
    await seedMember(orgId, 'owner')
    await seedMember(orgId, 'member1')

    const err = await assertTeamSeatQuota(orgId)
    expect(err).toContain('plano Grátis permite você + 1 membro')
  })

  it('Free: convite pendente CONTA como seat (anti-TOCTOU)', async () => {
    const orgId = uniqOrg()
    await seedOrg(orgId)
    await seedMember(orgId, 'owner')
    await seedInvite(orgId, 'inv-pending')

    const err = await assertTeamSeatQuota(orgId)
    expect(err).toContain('plano Grátis permite você + 1 membro')
  })

  it('Free: convite EXPIRADO libera o seat de volta', async () => {
    const orgId = uniqOrg()
    await seedOrg(orgId)
    await seedMember(orgId, 'owner')
    await seedInvite(orgId, 'inv-expired', { expiresAt: PAST })

    expect(await assertTeamSeatQuota(orgId)).toBeNull()
  })

  it('Free: membro revogado NÃO conta como seat', async () => {
    const orgId = uniqOrg()
    await seedOrg(orgId)
    await seedMember(orgId, 'owner')
    await seedMember(orgId, 'gone', 'revoked')

    expect(await assertTeamSeatQuota(orgId)).toBeNull()
  })

  it('Pro: equipe cheia nunca é barrada (team.unlimited)', async () => {
    const orgId = uniqOrg()
    await seedOrg(orgId)
    await seedTier(orgId, 'pro')
    await seedMember(orgId, 'owner')
    await seedMember(orgId, 'member1')
    await seedMember(orgId, 'member2')

    expect(await assertTeamSeatQuota(orgId)).toBeNull()
  })
})
