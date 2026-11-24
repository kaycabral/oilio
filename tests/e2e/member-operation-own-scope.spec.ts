import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import {
  linkMemberOperationToServices,
  seedAppointment,
  seedCustomer,
  seedLoginableMemberOperation,
  seedLoginableMemberWithoutProfile,
  seedService,
  setMembershipRole,
  signInAndAttachSession,
} from './helpers/session'
import { AgendaPage } from './pages/AgendaPage'

const sidebar = (page: Page) => page.locator('[data-sidebar="content"]')

const APPT_DATE = '2026-09-14'
const ownStartUtc = `${APPT_DATE}T13:00:00.000Z`
const ownEndUtc = `${APPT_DATE}T13:30:00.000Z`
const otherStartUtc = `${APPT_DATE}T14:00:00.000Z`
const otherEndUtc = `${APPT_DATE}T14:30:00.000Z`

test.describe('Profissional — escopo dos próprios dados (brief 0075)', () => {
  test.use({
    orgInput: {
      unitCount: 1,
      memberOperationCount: 1,
      memberOperationOperationalStatus: 'operational',
      hasBusinessHours: true,
      slotMinutes: 15,
    },
  })

  test('só enxerga a própria coluna na agenda, não a do colega', async ({
    context,
    page,
    org,
    baseURL,
  }) => {
    const unitId = org.unitIds[0]!
    const colleagueId = org.memberOperationIds[0]!
    const serviceId = await seedService(org.orgId, {
      name: 'Corte Own-Scope',
      publicVisible: true,
      unitIds: [unitId],
    })
    const me = await seedLoginableMemberOperation(org.orgId, {
      unitIds: [unitId],
      catalogServiceIds: [serviceId],
      displayName: 'Profissional Self',
    })
    await linkMemberOperationToServices(org.orgId, colleagueId, [serviceId])
    const customer = await seedCustomer(org.orgId, { name: 'Cliente Teste' })

    await seedAppointment({
      orgId: org.orgId,
      unitId,
      memberOperationId: me.memberOperationId,
      customerId: customer,
      serviceId,
      startAt: ownStartUtc,
      endAt: ownEndUtc,
    })
    await seedAppointment({
      orgId: org.orgId,
      unitId,
      memberOperationId: colleagueId,
      customerId: customer,
      serviceId,
      startAt: otherStartUtc,
      endAt: otherEndUtc,
    })

    await signInAndAttachSession(context, me.email, me.password, baseURL ?? undefined)
    const agenda = new AgendaPage(page)
    await agenda.goto(APPT_DATE)

    await expect(agenda.memberOperationColumn('Profissional Self')).toBeVisible()
    await expect(agenda.memberOperationColumn('Profissional 1')).toHaveCount(0)
  })

  test('nav esconde Cadastros, Administração e Assinaturas', async ({
    context,
    page,
    org,
    baseURL,
  }) => {
    const me = await seedLoginableMemberOperation(org.orgId, {
      unitIds: [org.unitIds[0]!],
      displayName: 'Profissional Self',
    })

    await signInAndAttachSession(context, me.email, me.password, baseURL ?? undefined)
    await page.goto('/agenda')
    await expect(page).toHaveURL(/\/agenda$/)

    const nav = sidebar(page)
    await expect(nav.getByRole('link', { name: 'Agenda' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Conta' })).toBeVisible()

    await expect(nav.getByText('Cadastros', { exact: true })).toHaveCount(0)
    await expect(nav.getByText('Administração', { exact: true })).toHaveCount(0)
    await expect(nav.getByRole('link', { name: 'Clientes' })).toHaveCount(0)
    await expect(nav.getByRole('link', { name: 'Catálogo' })).toHaveCount(0)
    await expect(nav.getByRole('link', { name: 'Planos' })).toHaveCount(0)
    await expect(nav.getByRole('link', { name: 'Assinaturas' })).toHaveCount(0)
    await expect(nav.getByRole('link', { name: 'Relatórios' })).toHaveCount(0)
    await expect(nav.getByRole('link', { name: 'Equipe' })).toHaveCount(0)
  })

  test('rota de Clientes redireciona um profissional (sem leitura)', async ({
    context,
    page,
    org,
    baseURL,
  }) => {
    const me = await seedLoginableMemberOperation(org.orgId, {
      unitIds: [org.unitIds[0]!],
      displayName: 'Profissional Self',
    })

    await signInAndAttachSession(context, me.email, me.password, baseURL ?? undefined)
    await page.goto('/customers')
    await expect(page).toHaveURL(/\/agenda$/)
  })

  test('diálogo de novo agendamento: picker só com o próprio nome e sem "Cadastrar novo"', async ({
    context,
    page,
    org,
    baseURL,
  }) => {
    const unitId = org.unitIds[0]!
    const serviceId = await seedService(org.orgId, {
      name: 'Corte Picker',
      publicVisible: true,
      unitIds: [unitId],
    })
    const me = await seedLoginableMemberOperation(org.orgId, {
      unitIds: [unitId],
      catalogServiceIds: [serviceId],
      displayName: 'Profissional Self',
    })

    await signInAndAttachSession(context, me.email, me.password, baseURL ?? undefined)
    const agenda = new AgendaPage(page)
    await agenda.goto(APPT_DATE)
    const dialog = await agenda.openNewAppointmentDialog()

    await expect(dialog.getByRole('button', { name: /Cadastrar novo/ })).toHaveCount(0)

    await dialog.getByRole('combobox', { name: 'Profissional' }).click()
    const listbox = page.getByRole('listbox')
    await expect(listbox.getByRole('option', { name: 'Profissional Self' })).toBeVisible()
    await expect(listbox.getByRole('option', { name: 'Profissional 1' })).toHaveCount(0)
  })

  test('balcão (recepção) é o superset operacional: vê todas as colunas e Clientes', async ({
    context,
    page,
    org,
    baseURL,
  }) => {
    await setMembershipRole(`${org.orgId}_${org.uid}`, 'receptionist')
    const unitId = org.unitIds[0]!
    const serviceId = await seedService(org.orgId, {
      name: 'Corte Balcão',
      publicVisible: true,
      unitIds: [unitId],
    })
    const me = await seedLoginableMemberOperation(org.orgId, {
      unitIds: [unitId],
      catalogServiceIds: [serviceId],
      displayName: 'Profissional Self',
    })
    expect(me.memberOperationId).toBeTruthy()

    await signInAndAttachSession(context, org.email, org.password, baseURL ?? undefined)
    const agenda = new AgendaPage(page)
    await agenda.goto(APPT_DATE)

    await expect(agenda.memberOperationColumn('Profissional 1')).toBeVisible()
    await expect(agenda.memberOperationColumn('Profissional Self')).toBeVisible()

    const nav = sidebar(page)
    await expect(nav.getByRole('link', { name: 'Clientes' })).toBeVisible()
    await expect(nav.getByText('Administração', { exact: true })).toHaveCount(0)
  })

  test('agenda sem perfil operacional mostra empty-state explícito (não grid mudo)', async ({
    context,
    page,
    org,
    baseURL,
  }) => {
    const me = await seedLoginableMemberWithoutProfile(org.orgId, {
      displayName: 'Sem Perfil',
    })

    await signInAndAttachSession(context, me.email, me.password, baseURL ?? undefined)
    const agenda = new AgendaPage(page)
    await agenda.goto(APPT_DATE)

    await expect(page.getByText(/seu perfil de agenda ainda não está pronto/i)).toBeVisible()
    await expect(agenda.memberOperationColumn('Profissional 1')).toHaveCount(0)
  })
})
