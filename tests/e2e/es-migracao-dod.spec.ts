import { AppointmentConfig, MemberOperationConfig } from '@/domain/aggregates'
import { aggregateRef } from '@/domain/effect'
import { Schema } from 'effect'
import { expect, test } from './fixtures'
import { listItem, rowAction } from './helpers/list'
import { choosePaymentMethod } from './helpers/select'
import {
  patchAppointmentSnapshot,
  pgListByOrg,
  pgQueryProjection,
  pgReadEventStream,
  pgReadProjection,
  seedAppointment,
  seedAuthUser,
  seedCustomer,
  seedCustomerShadowForUser,
  seedInvite,
  seedOrg,
  seedService,
  signInAndAttachSession,
  uniqueWhatsapp,
} from './helpers/session'
import { AgendaPage, MeAppointmentsPage } from './pages'

const EventTag = Schema.Struct({ _tag: Schema.String })
const decodeEventTag = Schema.decodeUnknownSync(EventTag)

const requireString = Schema.decodeUnknownSync(Schema.String)

test.describe('Migração ES seletivo 0027 — Definition of Done', () => {
  test.describe('Cenário 1 — PII fora de evento imutável', () => {
    test.use({ orgInput: { unitCount: 1, memberOperationCount: 0 } })

    test('member_operation.created não carrega PII; member_operations_pii carrega', async ({
      org,
      context,
      page,
      baseURL,
    }) => {
      const invitee = await seedAuthUser()
      const { inviteId, rawToken } = await seedInvite({
        orgId: org.orgId,
        mobile: '5511990001234',
        role: 'member_operator',
        invitedBy: org.uid,
      })
      await signInAndAttachSession(context, invitee.email, invitee.password, baseURL ?? undefined)
      await page.goto(`/invites/${org.orgId}/${inviteId}?token=${rawToken}`)
      await page.getByRole('button', { name: /aceitar convite/i }).click()
      await expect(page).toHaveURL(/\/agenda/, { timeout: 10_000 })

      const proRows = await pgListByOrg('member_operations', org.orgId)
      expect(proRows).toHaveLength(1)
      const proId = requireString(proRows[0]?.id)
      const proRef = aggregateRef(MemberOperationConfig, org.orgId, proId)

      const stream = await pgReadEventStream(proRef)
      expect(stream.length).toBeGreaterThanOrEqual(1)
      expect(decodeEventTag(stream[0])._tag).toBe('member_operation.created')

      // global (#1046 / brief 0028 AC-04/AC-05) — não é mais copiada pro
      const userRows = await pgQueryProjection('users', 'uid', invitee.uid)
      expect(userRows).toHaveLength(1)
      const userRow = userRows[0]
      expect(userRow?.display_name).toBe('E2E Invitee')
      expect(userRow?.mobile).toMatch(/^5511\d{9}$/)
      expect(userRow?.email).toBe(invitee.email)

      const streamJson = JSON.stringify(stream)
      expect(streamJson).not.toContain('E2E Invitee')
      expect(streamJson).not.toContain(requireString(userRow?.mobile))
      expect(streamJson).not.toContain(invitee.email)

      const piiRow = await pgReadProjection('member_operations_pii', proRef)
      expect(piiRow).not.toBeNull()
      expect(piiRow?.name).toBeUndefined()
      expect(piiRow?.mobile).toBeUndefined()
      expect(piiRow?.email).toBeUndefined()
      expect('tax_identity' in (piiRow ?? {})).toBe(true)
    })
  })

  test.describe('Cenário 2 — editar agendamento não driva a order', () => {
    test.use({
      orgInput: { unitCount: 1, memberOperationCount: 1, slotMinutes: 30, hasBusinessHours: true },
    })

    test('order fechada usa snapshot travado, não o appointment driftado', async ({
      org,
      authedPage,
    }) => {
      const serviceId = await seedService(org.orgId, {
        name: 'Corte DoD',
        durationMinutes: 30,
        priceCents: 5000,
        commission: { kind: 'percentage', value: 50 },
        unitIds: org.unitIds,
      })
      const customerId = await seedCustomer(org.orgId, {
        name: 'Cliente DoD',
        mobile: uniqueWhatsapp(),
      })
      const appointmentId = await seedAppointment({
        orgId: org.orgId,
        unitId: org.unitIds[0]!,
        memberOperationId: org.memberOperationIds[0]!,
        customerId,
        serviceId,
        startAt: '2026-09-08T17:00:00.000Z',
        endAt: '2026-09-08T17:30:00.000Z',
        status: 'scheduled',
        servicePriceCentsSnapshot: 5000,
        serviceDurationMinutesSnapshot: 30,
        commissionSnapshot: { kind: 'percentage', value: 50 },
      })

      const agenda = new AgendaPage(authedPage)
      await agenda.goto('2026-09-08')
      await authedPage.getByRole('button', { name: /Cliente DoD/ }).click()
      await authedPage.getByRole('button', { name: /Iniciar atendimento/ }).click()
      await expect(authedPage).toHaveURL(/\/orders\/.+/)
      await expect(authedPage.getByText('1 × R$ 50,00')).toBeVisible()

      await patchAppointmentSnapshot(org.orgId, appointmentId, {
        servicePriceCentsSnapshot: 99900,
        commissionSnapshot: { kind: 'percentage', value: 10 },
      })
      const drifted = await pgReadProjection(
        'appointments',
        aggregateRef(AppointmentConfig, org.orgId, appointmentId),
      )
      expect(drifted?.service_price_cents_snapshot).toBe('99900')

      await choosePaymentMethod(authedPage, 'pix')
      await authedPage.getByRole('button', { name: /Fechar venda/ }).click()
      const dialog = authedPage.getByRole('dialog', { name: 'Confirmar fechamento' })
      await expect(dialog).toBeVisible()
      await dialog.getByRole('button', { name: /Confirmar fechamento/ }).click()
      await expect(authedPage.getByText(/Fechada em/)).toBeVisible({ timeout: 5000 })

      const commissionSection = authedPage
        .locator('section')
        .filter({ has: authedPage.getByRole('heading', { name: 'Comissões geradas' }) })
      await expect(commissionSection.getByText('R$ 25,00').first()).toBeVisible()
      await expect(authedPage.getByText('R$ 99,90')).toHaveCount(0)
    })
  })

  test('Cenário 3 — elegibilidade segue o snapshot, não a policy viva', async ({
    context,
    page,
    baseURL,
  }) => {
    const seed = await seedOrg({
      unitCount: 1,
      memberOperationCount: 1,
      cancellationPolicy: { enabled: false, minNoticeMinutes: 0 },
    })
    const serviceId = await seedService(seed.orgId, {
      name: 'Corte DoD Snapshot',
      publicVisible: true,
      unitIds: seed.unitIds,
    })
    const customer = await seedAuthUser()
    const customerId = await seedCustomerShadowForUser(seed.orgId, customer.uid)
    const startAt = new Date(Date.now() + 30 * 60_000).toISOString()
    const endAt = new Date(Date.now() + 60 * 60_000).toISOString()
    await seedAppointment({
      orgId: seed.orgId,
      unitId: seed.unitIds[0]!,
      memberOperationId: seed.memberOperationIds[0]!,
      customerId,
      serviceId,
      startAt,
      endAt,
      cancellationPolicySnapshot: { enabled: true, minNoticeMinutes: 120 },
    })

    await signInAndAttachSession(context, customer.email, customer.password, baseURL ?? undefined)
    const me = new MeAppointmentsPage(page)
    await me.goto()
    await expect(me.cancelButton()).toBeDisabled()
    await expect(page.getByText(/2\s*horas\s*de\s*antecedência/i)).toBeVisible()
  })

  test.describe('Cenário 4 — 1 verbo "Excluir": em uso soft-delete, livre hard-delete', () => {
    test.use({ orgInput: { unitCount: 1, memberOperationCount: 1 } })

    test('unidade em uso por profissional → "Excluir" vira soft-delete (some da ativa)', async ({
      authedPage,
    }) => {
      await authedPage.goto('/units')
      await expect(listItem(authedPage, /Unidade 1/)).toBeVisible()
      await expect(authedPage.getByRole('button', { name: 'Arquivar' })).toHaveCount(0)

      await rowAction(authedPage, /Unidade 1/, 'Excluir')
      const dialog = authedPage.getByRole('alertdialog')
      await expect(dialog).toBeVisible()
      await expect(dialog.getByText(/profissional ativo ou agendamento futuro/i)).toBeVisible()
      await dialog.getByRole('textbox').fill('Unidade 1')
      await dialog.getByRole('button', { name: 'Excluir' }).click()

      await expect(listItem(authedPage, /Unidade 1/)).toBeHidden({ timeout: 5000 })
    })
  })
})
