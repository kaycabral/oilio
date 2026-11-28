import {
  anonymizedLabel,
  buildUserAnonymizationScrub,
  membershipDocId,
  Membership as MembershipSchema,
  type Membership,
} from '@/domain'
import { MembershipConfig } from '@/domain/aggregates'
import { aggregateRef } from '@/domain/effect'
import {
  MEMBERSHIP_COLUMNS,
  membershipColumnValues,
  rowToDoc as membershipRowToDoc,
  type MembershipRow,
} from '@/shared/db/pg/effect/membership-projector'
import { patchUser } from '@/shared/db/pg/users-store'
import { Schema, SchemaTransformation } from 'effect'
import { expect, test } from '../fixtures'
import {
  pgReadProjection,
  seedClosedOrder,
  seedCommission,
  type SeededOrg,
} from '../helpers/session'

const TimestamptzString = Schema.Union([Schema.String, Schema.Date]).pipe(
  Schema.decodeTo(
    Schema.String,
    SchemaTransformation.transform<string, string | Date>({
      decode: (value) => (value instanceof Date ? value.toISOString() : value),
      encode: (value) => value,
    }),
  ),
)

const MembershipRowSchema = Schema.Struct({
  org_id: Schema.String,
  id: Schema.String,
  user_id: Schema.String,
  last_event_version: Schema.Union([Schema.String, Schema.Number]),
  role: Schema.String,
  status: Schema.String,
  rls_unit_scope: Schema.NullOr(Schema.String),
  invited_by: Schema.NullOr(Schema.String),
  joined_at: TimestamptzString,
  permissions: Schema.Unknown,
  updated_at: TimestamptzString,
})

async function revokeMembership(orgId: string, userId: string): Promise<void> {
  const membershipId = membershipDocId(orgId, userId)
  const ref = aggregateRef(MembershipConfig, orgId, membershipId)
  const row = await pgReadProjection('memberships', ref)
  if (!row) throw new Error(`revokeMembership: membership ${membershipId} not found`)
  const typedRow: MembershipRow = Schema.decodeUnknownSync(MembershipRowSchema)(row)
  const current = Schema.decodeUnknownSync(MembershipSchema)(membershipRowToDoc(typedRow))
  const next: Membership = { ...current, status: 'revoked', updatedAt: new Date().toISOString() }
  const { Client } = await import('pg')
  const client = new Client({ connectionString: process.env.OILIO_DATABASE_URL })
  await client.connect()
  try {
    await client.query('BEGIN')
    const cur = await client.query<{ last_event_version: number }>(
      'SELECT last_event_version FROM memberships WHERE org_id = $1 AND id = $2',
      [ref.orgId, ref.id],
    )
    const nextVersion = (cur.rows[0]?.last_event_version ?? 1) + 1
    await client.query(
      `INSERT INTO events (aggregate_type, aggregate_id, version, org_id, envelope)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        ref.type,
        ref.id,
        nextVersion,
        ref.orgId,
        {
          _tag: 'membership.updated',
          version: nextVersion,
          timestamp: next.updatedAt,
          actorId: 'e2e-seed',
          schemaVersion: 1,
          payload: { data: next },
        },
      ],
    )
    const values = membershipColumnValues(next, ref, nextVersion)
    const assignments = MEMBERSHIP_COLUMNS.map((col, i) => `${col} = $${i + 1}`).join(', ')
    const placeholders = MEMBERSHIP_COLUMNS.map((_, i) => `$${i + 1}`).join(', ')
    await client.query(
      `INSERT INTO memberships (${MEMBERSHIP_COLUMNS.join(', ')}) VALUES (${placeholders})
       ON CONFLICT (org_id, id) DO UPDATE SET ${assignments}`,
      [...values],
    )
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    await client.end()
  }
}

async function anonymizeUser(uid: string): Promise<void> {
  const now = new Date().toISOString()
  const scrub = buildUserAnonymizationScrub(now)
  const patched = await patchUser(
    uid,
    {
      display_name: scrub.displayName,
      mobile: scrub.mobile,
      email: scrub.email,
      birth_date: scrub.birthDate,
      tax_identity: scrub.taxIdentity,
      bio: scrub.bio,
      specialties: scrub.specialties,
      avatar_url: scrub.avatarUrl,
      anonymized_at: scrub.anonymizedAt,
    },
    now,
  )
  if (!patched) throw new Error(`anonymizeUser: user ${uid} not found`)
}

async function seedCommissionWithSnapshot(
  org: SeededOrg,
  c: {
    attributedUserId: string
    attributedMemberName: string
    itemName: string
    createdAt: string
  },
): Promise<void> {
  const orderId = await seedClosedOrder({
    orgId: org.orgId,
    unitId: org.unitIds[0] ?? 'unit',
    customerId: null,
    attributedUserId: c.attributedUserId,
    totalCents: 5000,
    closedAt: c.createdAt,
  })
  await seedCommission({
    orgId: org.orgId,
    attributedUserId: c.attributedUserId,
    amountCents: 2500,
    liquidationStatus: 'pendente',
    orderId,
    itemName: c.itemName,
    attributedMemberName: c.attributedMemberName,
  })
}

test.describe(
  'Comissão de profissional revogado fica identificável (#1106)',
  { tag: '@critical' },
  () => {
    test.use({
      orgInput: { memberOperationCount: 1, memberOperationOperationalStatus: 'operational' },
    })

    test('AC-11/AC-03: revogar a membership não some o nome — snapshot mostra o nome real', async ({
      org,
      authedPage,
    }) => {
      const proId = org.memberOperationIds[0]!
      const proUser = `e2e-prof-user-${proId}`
      const realName = 'Profissional 1'
      const now = new Date().toISOString()

      await seedCommissionWithSnapshot(org, {
        attributedUserId: proUser,
        attributedMemberName: realName,
        itemName: 'Corte do Revogado',
        createdAt: now,
      })

      await revokeMembership(org.orgId, proUser)

      await authedPage.goto('/reports')
      await expect(
        authedPage.getByRole('heading', { name: 'Relatório de comissões' }),
      ).toBeVisible()

      await expect(authedPage.getByText('Corte do Revogado')).toBeVisible()

      await expect(authedPage.getByText(realName).first()).toBeVisible()

      const commissionsRegion = authedPage.locator('form', {
        has: authedPage.getByRole('button', { name: 'Filtrar' }),
      })
      await expect(commissionsRegion).toBeVisible()
      const revokedRow = authedPage.getByRole('listitem').filter({ hasText: 'Corte do Revogado' })
      await expect(revokedRow.getByText(realName)).toBeVisible()
    })

    test('AC-11 (b): anonimizar a conta GLOBAL do profissional não some o nome — snapshot vence o join ao vivo', async ({
      org,
      authedPage,
    }) => {
      const proId = org.memberOperationIds[0]!
      const proUser = `e2e-prof-user-${proId}`
      const realName = 'Profissional 1'
      const now = new Date().toISOString()

      await seedCommissionWithSnapshot(org, {
        attributedUserId: proUser,
        attributedMemberName: realName,
        itemName: 'Corte do Anonimizado',
        createdAt: now,
      })

      await anonymizeUser(proUser)

      const neutralLabel = anonymizedLabel(proUser, 'Profissional')

      await authedPage.goto('/reports')
      await expect(
        authedPage.getByRole('heading', { name: 'Relatório de comissões' }),
      ).toBeVisible()

      await expect(authedPage.getByText('Corte do Anonimizado')).toBeVisible()

      const anonRow = authedPage.getByRole('listitem').filter({ hasText: 'Corte do Anonimizado' })
      await expect(anonRow.getByText(realName)).toBeVisible()
      await expect(anonRow.getByText(neutralLabel)).toHaveCount(0)

      await authedPage.getByRole('combobox', { name: 'Membro' }).click()
      await expect(authedPage.getByRole('option', { name: neutralLabel })).toBeAttached()
      await authedPage.keyboard.press('Escape')
    })
  },
)
