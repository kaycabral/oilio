import { membershipDocId } from '@/domain'
import {
  deriveOperationalStatus,
  MemberOperationConfig,
  MembershipConfig,
} from '@/domain/aggregates'
import { aggregateRef } from '@/domain/effect'
import { formatBrazilPhone } from '@cbrl/br/phone'
import type { BrowserContext, Page } from '@playwright/test'
import { Schema } from 'effect'
import { expect, test } from '../fixtures'
import { nextWeekday } from '../helpers/date'
import {
  pgListByOrg,
  pgQueryProjection,
  pgReadEventStream,
  pgReadProjection,
  seedAuthUser,
  seedInvite,
  seedService,
  signInAndAttachSession,
  uniqueWhatsapp,
} from '../helpers/session'
import { MemberOperationsPage, orgSlug, PublicBookingPage } from '../pages'

const UserRowSchema = Schema.Struct({
  uid: Schema.String,
  display_name: Schema.NullOr(Schema.String),
  mobile: Schema.NullOr(Schema.String),
  email: Schema.NullOr(Schema.String),
})
const decodeUserRow = Schema.decodeUnknownSync(UserRowSchema)

const MemberOperationRowSchema = Schema.Struct({
  id: Schema.String,
  user_id: Schema.NullOr(Schema.String),
  unit_ids: Schema.Unknown,
  catalog_service_ids: Schema.Unknown,
})
const decodeMemberOperationRow = Schema.decodeUnknownSync(MemberOperationRowSchema)

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string')
  if (typeof value === 'string') {
    try {
      return asStringArray(JSON.parse(value))
    } catch {
      return []
    }
  }
  return []
}

const EventEnvelopeSchema = Schema.Struct({ _tag: Schema.String })
const decodeEventEnvelope = Schema.decodeUnknownSync(EventEnvelopeSchema)

type StoredPro = { id: string; userId: string | null; operationalStatus: string | null }

async function readUserRow(uid: string): Promise<{
  displayName: string | null
  mobile: string | null
  email: string | null
} | null> {
  const rows = await pgQueryProjection('users', 'uid', uid)
  const match = rows.find((r) => r.uid === uid)
  if (!match) return null
  const decoded = decodeUserRow(match)
  return { displayName: decoded.display_name, mobile: decoded.mobile, email: decoded.email }
}

function requireUserStr(
  user: { displayName: string | null; mobile: string | null; email: string | null },
  uid: string,
  key: 'displayName' | 'mobile' | 'email',
): string {
  const value = user[key]
  if (value === null) {
    throw new Error(`users/${uid}.${key} is null`)
  }
  return value
}

async function listMemberOperations(orgId: string): Promise<StoredPro[]> {
  const rows = await pgListByOrg('member_operations', orgId)
  const out: StoredPro[] = []
  for (const r of rows) {
    const decoded = decodeMemberOperationRow(r)
    const user = decoded.user_id ? await readUserRow(decoded.user_id) : null
    const operationalStatus = deriveOperationalStatus({
      inviteAccepted: true,
      mobile: user?.mobile ?? null,
      unitIds: asStringArray(decoded.unit_ids),
      catalogServiceIds: asStringArray(decoded.catalog_service_ids),
    })
    out.push({ id: decoded.id, userId: decoded.user_id, operationalStatus })
  }
  return out
}

async function patchUserMobile(uid: string, mobile: string | null): Promise<void> {
  const { Client } = await import('pg')
  const client = new Client({ connectionString: process.env.OILIO_DATABASE_URL })
  await client.connect()
  try {
    await client.query('UPDATE users SET mobile = $1, completion_completed = $2 WHERE uid = $3', [
      mobile,
      mobile !== null,
      uid,
    ])
  } finally {
    await client.end()
  }
}

async function inviteAccept(opts: {
  org: { orgId: string; uid: string }
  context: BrowserContext
  page: Page
  baseURL: string | undefined
  role: 'member_operator' | 'manager'
  invitee: { uid: string; email: string; password: string }
}): Promise<void> {
  const { inviteId, rawToken } = await seedInvite({
    orgId: opts.org.orgId,
    mobile: uniqueWhatsapp(),
    role: opts.role,
    invitedBy: opts.org.uid,
  })
  await signInAndAttachSession(
    opts.context,
    opts.invitee.email,
    opts.invitee.password,
    opts.baseURL ?? undefined,
  )
  await opts.page.goto(`/invites/${opts.org.orgId}/${inviteId}?token=${rawToken}`)
  await opts.page.getByRole('button', { name: /aceitar convite/i }).click()
  const landing = opts.role === 'manager' ? /\/dashboard/ : /\/agenda/
  await expect(opts.page).toHaveURL(landing, { timeout: 10_000 })
}

test.describe('Profissional = membro — Definition of Done (#1044)', { tag: '@journey' }, () => {
  test.describe('Cenário 1 — convite → aceite → perfil → operável', () => {
    test.use({ orgInput: { unitCount: 1, memberOperationCount: 0 } })

    test('owner convida Profissional, convidado aceita e completa perfil → operável (1 pro, userId não-nulo, identidade derivada, operational, na agenda)', async ({
      org,
      context,
      page,
      authedPage,
      baseURL,
    }) => {
      const unitId = org.unitIds[0]!
      const serviceId = await seedService(org.orgId, {
        name: 'Corte Jornada',
        durationMinutes: 30,
        priceCents: 5000,
        publicVisible: true,
        unitIds: [unitId],
      })

      expect(await listMemberOperations(org.orgId)).toHaveLength(0)

      const maria = await seedAuthUser()
      await inviteAccept({ org, context, page, baseURL, role: 'member_operator', invitee: maria })

      await signInAndAttachSession(context, org.email, org.password, baseURL ?? undefined)

      const m = await pgReadProjection(
        'memberships',
        aggregateRef(MembershipConfig, org.orgId, membershipDocId(org.orgId, maria.uid)),
      )
      expect(m).not.toBeNull()
      expect(m?.role).toBe('member_operator')

      let pros = await listMemberOperations(org.orgId)
      expect(pros).toHaveLength(1)
      expect(pros[0]!.userId).toBe(maria.uid)

      const prosPage = new MemberOperationsPage(authedPage)
      await prosPage.gotoByUserId(maria.uid)
      const user = await readUserRow(maria.uid)
      expect(user).not.toBeNull()
      const identity = user ?? { displayName: null, mobile: null, email: null }
      await expect(prosPage.identityName()).toHaveText(
        requireUserStr(identity, maria.uid, 'displayName'),
      )
      await expect(prosPage.identityWhatsapp()).toHaveText(
        formatBrazilPhone(requireUserStr(identity, maria.uid, 'mobile')),
      )
      await expect(prosPage.identityEmail()).toContainText(
        requireUserStr(identity, maria.uid, 'email'),
      )

      await expect(prosPage.operationalStatus()).toHaveText('Cadastro incompleto')

      await authedPage.getByRole('checkbox', { name: 'Unidade 1' }).check()
      await authedPage.getByRole('checkbox', { name: 'Corte Jornada' }).check()
      await prosPage.saveButton().click()
      await expect(authedPage.getByText('Alterações salvas.')).toBeVisible()

      await prosPage.gotoByUserId(maria.uid)
      await expect(prosPage.operationalStatus()).toHaveText('Operacional')
      pros = await listMemberOperations(org.orgId)
      expect(pros).toHaveLength(1)
      expect(pros[0]!.userId).toBe(maria.uid)
      expect(pros[0]!.operationalStatus).toBe('operational')

      const booking = new PublicBookingPage(page, orgSlug(org.orgId))
      await booking.gotoAvailability('unidade-1', { serviceId, from: nextWeekday('Wed') })
      await expect(booking.slotByMemberOperation('E2E Invitee').first()).toBeVisible()
    })
  })

  test.describe('Cenário 2 — status não destravável à mão', () => {
    test.use({
      orgInput: {
        unitCount: 1,
        memberOperationCount: 1,
        memberOperationOperationalStatus: 'incomplete',
      },
    })

    test('sem WhatsApp/serviço fica incompleto, sem input de status e fora da agenda pública', async ({
      org,
      authedPage,
      page,
    }) => {
      const proId = org.memberOperationIds[0]!
      const unitId = org.unitIds[0]!
      await patchUserMobile(`e2e-prof-user-${proId}`, null)

      const serviceId = await seedService(org.orgId, {
        name: 'Corte',
        durationMinutes: 30,
        priceCents: 5000,
        publicVisible: true,
        unitIds: [unitId],
      })

      const prosPage = new MemberOperationsPage(authedPage)
      await prosPage.gotoById(proId)
      await expect(prosPage.operationalStatus()).toHaveText('Cadastro incompleto')

      await expect(authedPage.locator('select[name="operationalStatus"]')).toHaveCount(0)
      await expect(authedPage.locator('[name="operationalStatus"]')).toHaveCount(0)

      const booking = new PublicBookingPage(page, orgSlug(org.orgId))
      await booking.gotoAvailability('unidade-1', { serviceId, from: nextWeekday('Wed') })
      await expect(booking.slotByMemberOperation('Profissional 1')).toHaveCount(0)
    })
  })

  test.describe('Cenário 3 — identidade derivada, sem divergência', () => {
    test.use({ orgInput: { unitCount: 1, memberOperationCount: 1 } })

    test('identidade read-only espelha users/{userId}; alterar User.mobile reflete sem reescrever a projeção', async ({
      org,
      authedPage,
    }) => {
      const proId = org.memberOperationIds[0]!
      const uid = `e2e-prof-user-${proId}`
      const prosPage = new MemberOperationsPage(authedPage)

      await prosPage.gotoById(proId)
      await expect(authedPage.locator('input[name="name"]')).toHaveCount(0)
      await expect(authedPage.locator('input[name="mobile"]')).toHaveCount(0)
      await expect(authedPage.locator('input[name="email"]')).toHaveCount(0)
      await expect(prosPage.identityWhatsapp()).toHaveText(/^\(\d{2}\) \d{5}-\d{4}$/)

      const newMobile = uniqueWhatsapp()
      await patchUserMobile(uid, newMobile)

      await prosPage.gotoById(proId)
      await expect(prosPage.identityWhatsapp()).toHaveText(formatBrazilPhone(newMobile))
    })
  })

  test.describe('Cenário 4 — seed/modelo novo: materialização event-sourced sem userId nulo nem status hardcoded', () => {
    test.use({ orgInput: { unitCount: 1, memberOperationCount: 0 } })

    test('o profissional nasce só da saga (membership → member_operation.created com userId, sem PII no evento, approval derivado)', async ({
      org,
      context,
      page,
      baseURL,
    }) => {
      const invitee = await seedAuthUser()
      await inviteAccept({ org, context, page, baseURL, role: 'member_operator', invitee })

      const m = await pgReadProjection(
        'memberships',
        aggregateRef(MembershipConfig, org.orgId, membershipDocId(org.orgId, invitee.uid)),
      )
      expect(m?.role).toBe('member_operator')
      const pros = await listMemberOperations(org.orgId)
      expect(pros).toHaveLength(1)
      const proId = pros[0]!.id
      expect(pros[0]!.userId).toBe(invitee.uid)
      expect(pros[0]!.userId).not.toBeNull()

      const eventStream = await pgReadEventStream(
        aggregateRef(MemberOperationConfig, org.orgId, proId),
      )
      const created = eventStream[0]
      expect(decodeEventEnvelope(created)._tag).toBe('member_operation.created')
      const envelopeJson = JSON.stringify(created)
      expect(envelopeJson).not.toContain('E2E Invitee')
      const inviteeUserRows = await pgQueryProjection('users', 'uid', invitee.uid)
      const inviteeMobile = inviteeUserRows[0]?.mobile
      expect(inviteeMobile).toMatch(/^5511\d{9}$/)
      expect(envelopeJson).not.toContain(String(inviteeMobile))
      expect(envelopeJson).not.toContain(invitee.email)

      expect(pros[0]!.operationalStatus).toBe('incomplete')
    })
  })
})
