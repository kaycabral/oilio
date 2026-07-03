// E2E spec — brief 0041 AC-11 + AC-03 (#1106): identidade do profissional
// SNAPSHOTADA no registro de comissão (retenção de vínculo, art. 16).
//
// O bug: revogar um membro (offboarding #1103 → membership `status: 'revoked'`)
// fazia o relatório de comissões mostrar "--" pra ele, porque o nome era
// resolvido por JOIN AO VIVO em `listOrgMembers` (`status==active`) — o
// revogado some do join → nome vazio. Viola AC-03 (comissão tem que ficar
// identificável). O fix snapshota o `attributedMemberName` no próprio registro
// na apuração, então o relatório lê o snapshot e o nome real sobrevive à
// revogação / suspensão / anonimização-como-cliente.
//
// Este spec é o gate do #1106: seed comissão COM snapshot → revoga a membership
// → o relatório mostra o NOME REAL (não "--", não rótulo neutro).

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
import { Schema } from 'effect'
import { expect, test } from '../fixtures'
import {
  pgReadProjection,
  seedClosedOrder,
  seedCommission,
  type SeededOrg,
} from '../helpers/session'

// A `timestamptz` column (brief 0068 D1) comes back from the pg driver as a
// `Date` on a raw `SELECT *`, but `MembershipRow` types it as `string`. Decode
// either shape to an ISO string so the row matches `MembershipRow` (the
// projector's `rowToDoc` re-normalizes anyway — this just keeps the lenient
// decode honest).
const TimestamptzString = Schema.transform(
  Schema.Union(Schema.String, Schema.DateFromSelf),
  Schema.String,
  {
    decode: (value) => (value instanceof Date ? value.toISOString() : value),
    encode: (value) => value,
  },
)

// Lenient decode of the `memberships` projection row (snake_case columns) into
// the typed `MembershipRow` the projector's `rowToDoc` consumes. Excess columns
// are ignored; this only types the fields `rowToDoc` reads. The projection
// version column is `last_event_version` (D6).
const MembershipRowSchema = Schema.Struct({
  org_id: Schema.String,
  id: Schema.String,
  user_id: Schema.String,
  last_event_version: Schema.Union(Schema.String, Schema.Number),
  role: Schema.String,
  status: Schema.String,
  rls_unit_scope: Schema.NullOr(Schema.String),
  invited_by: Schema.NullOr(Schema.String),
  joined_at: TimestamptzString,
  permissions: Schema.Unknown,
  updated_at: TimestamptzString,
})

// Post-cutover the event store is Postgres. A spec fixture that mutates an
// EXISTING aggregate (here: flip a membership to `revoked`) appends the next
// `membership.updated` event + re-projects the full row in one transaction —
// mirroring the runtime projector and the private `mutateProjectionPostgres`
// seed helper (kept local since session.ts exposes no status mutation).
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
    // Projection PK is composite `(org_id, id)`; the version column is
    // `last_event_version` (D6). Read + bump it for the appended event.
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

// Anonymizes the GLOBAL `users/{uid}` row in place (mirror of #1093's
// `buildUserAnonymizationScrub`): PII collapses to null + `anonymizedAt` set.
// The membership stays active — the live join still finds the member, but
// `resolveSubjectName` neutralizes it to `‹Profissional› ‹CÓDIGO›`. Returns
// nothing; the snapshot on the commission must still win.
async function anonymizeUser(uid: string): Promise<void> {
  const now = new Date().toISOString()
  // Mirror `anonymizationColumnPatch` (anonymize-account.ts): the full PII scrub
  // collapses to the snake_case `users` columns in ONE UPDATE, so `anonymized_at`
  // lands alongside the nulled PII and the `users_anonymized_pii_scrubbed` CHECK
  // never sees an intermediate violating state.
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

// Seeds a commission carrying the identity snapshot (`attributedMemberName`) —
// exactly what the close flow now writes (brief 0041 AC-11). A matching closed
// order (in window) keeps the commission in the report scope (the report maps
// commission→unit via `orderId`).
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
      // O fixture seed o User com displayName "Profissional 1" (helpers/session.ts).
      const realName = 'Profissional 1'
      const now = new Date().toISOString()

      await seedCommissionWithSnapshot(org, {
        attributedUserId: proUser,
        attributedMemberName: realName,
        itemName: 'Corte do Revogado',
        createdAt: now,
      })

      // Revoga a membership (o que o offboarding #1103 faz): some do join ao vivo
      // `listOrgMembers` (`status==active`). Com o join, o nome viria vazio →
      // "--". Com o snapshot, o nome real sobrevive.
      await revokeMembership(org.orgId, proUser)

      await authedPage.goto('/reports')
      await expect(
        authedPage.getByRole('heading', { name: 'Relatório de comissões' }),
      ).toBeVisible()

      // A comissão do revogado aparece.
      await expect(authedPage.getByText('Corte do Revogado')).toBeVisible()

      // E o NOME REAL aparece — não "--"/"—" (join dropado) nem rótulo neutro.
      // O nome vem do snapshot no registro (AC-11), imune à revogação.
      await expect(authedPage.getByText(realName).first()).toBeVisible()

      // Garantia negativa: o placeholder de nome-não-resolvido NÃO aparece pra
      // este membro. "—" (em dash) era o sintoma do bug.
      const commissionsRegion = authedPage.locator('form', {
        has: authedPage.getByRole('button', { name: 'Filtrar' }),
      })
      await expect(commissionsRegion).toBeVisible()
      // A linha da comissão do revogado mostra o nome real, não o placeholder.
      const revokedRow = authedPage.getByRole('listitem').filter({ hasText: 'Corte do Revogado' })
      await expect(revokedRow.getByText(realName)).toBeVisible()
    })

    test('AC-11 (b): anonimizar a conta GLOBAL do profissional não some o nome — snapshot vence o join ao vivo', async ({
      org,
      authedPage,
    }) => {
      // O "buraco global-anon" que o snapshot fecha: a MESMA pessoa também é
      // cliente e anonimiza a conta global (`users/{uid}` scrubbado +
      // `anonymizedAt` setado, igual ao account-anonymization #1093). A
      // membership segue ATIVA (não é offboarding) — então `listOrgMembers`
      // ACHA o membro no join ao vivo, mas `resolveSubjectName` neutraliza pra
      // `‹Profissional› ‹CÓDIGO›` por causa do `anonymizedAt`. Sem o snapshot, o
      // relatório resolveria o nome por esse join → rótulo neutro (errado). Com
      // o snapshot no registro (AC-11), o nome real sobrevive. Este teste prova
      // que o relatório lê o SNAPSHOT, não o join ao vivo.
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

      // Anonimiza a conta GLOBAL (espelha buildUserAnonymizationScrub do #1093):
      // scrub de toda a PII + anonymizedAt setado. A membership fica intacta.
      // Full scrub — mirror buildUserAnonymizationScrub (#1093): a PII inteira
      // colapsa pra null, então o read strict-decoded resolve o branch
      // `UserAnonymized`.
      await anonymizeUser(proUser)

      // Sanidade: com a conta anonimizada, o join ao vivo neutralizaria pra este
      // rótulo. É exatamente o que o relatório NÃO pode exibir.
      const neutralLabel = anonymizedLabel(proUser, 'Profissional')

      await authedPage.goto('/reports')
      await expect(
        authedPage.getByRole('heading', { name: 'Relatório de comissões' }),
      ).toBeVisible()

      // A comissão do anonimizado aparece.
      await expect(authedPage.getByText('Corte do Anonimizado')).toBeVisible()

      // A LINHA da comissão mostra o NOME REAL — vindo do snapshot, imune à
      // anonimização global. Nem rótulo neutro, nem "--"/"—".
      const anonRow = authedPage.getByRole('listitem').filter({ hasText: 'Corte do Anonimizado' })
      await expect(anonRow.getByText(realName)).toBeVisible()
      await expect(anonRow.getByText(neutralLabel)).toHaveCount(0)

      // Contraste — a PROVA de que o relatório lê o snapshot, não o join ao vivo:
      // o join ao vivo (`listOrgMembers`) NEUTRALIZA por causa do
      // `anonymizedAt`, então o dropdown de filtro "Membro" (alimentado pelo
      // join) mostra o rótulo neutro `‹Profissional› ‹CÓDIGO›`. Se a linha da
      // comissão lesse a mesma fonte, mostraria o mesmo rótulo — o bug do #1106.
      // O filtro "Membro" é um combobox (design): suas opções só montam quando
      // aberto, então abrimos pra inspecionar o rótulo neutro do join ao vivo.
      await authedPage.getByRole('combobox', { name: 'Membro' }).click()
      await expect(authedPage.getByRole('option', { name: neutralLabel })).toBeAttached()
      await authedPage.keyboard.press('Escape')
    })
  },
)
