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

// Brief 0075 (#1253) — DoD: a self-scoped memberOperation only reaches their OWN
// data. These specs sign in AS the memberOperation (a real auth user via
// `seedLoginableMemberOperation`, not the synthetic `e2e-prof-user-*`) and prove:
//   1. the agenda shows only their own column, never a colleague's;
//   2. the registration surfaces (Clientes/Catálogo/Planos/Assinaturas) and the
//      whole Administração section are gone from the nav;
//   3. the new-appointment dialog offers ONLY themselves in the memberOperation
//      picker and hides the "Cadastrar novo" customer toggle;
//   4. the balcão (recepção) is the operational superset — it sees every
//      memberOperation's column and keeps Clientes.
//
// Capability-gated, never role-branched: the same assertions would hold for any
// future custom role whose matrix matches the memberOperation preset.

const sidebar = (page: Page) => page.locator('[data-sidebar="content"]')

// A future business day at 10:00 local (America/Sao_Paulo, UTC-3) → 13:00Z, so
// the appointment lands inside default business hours on a single known day.
// 2026-09-14 is a Monday — a known weekday inside default business hours.
const APPT_DATE = '2026-09-14'
const ownStartUtc = `${APPT_DATE}T13:00:00.000Z`
const ownEndUtc = `${APPT_DATE}T13:30:00.000Z`
const otherStartUtc = `${APPT_DATE}T14:00:00.000Z`
const otherEndUtc = `${APPT_DATE}T14:30:00.000Z`

test.describe('Profissional — escopo dos próprios dados (brief 0075)', () => {
  // One unit, one seeded (colleague) memberOperation named "Profissional 1". The
  // logged-in memberOperation is the loginable one we add below.
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
    // Shared bookable service, linked to my memberOperation so it renders as an
    // operational column on the agenda (whatsapp ∧ ≥1 unit ∧ ≥1 service).
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

    // One appointment for me, one for the colleague — same unit, same day.
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

    // My own column renders…
    await expect(agenda.memberOperationColumn('Profissional Self')).toBeVisible()
    // …the colleague's column does not (RLS hides their row + the read layer
    // scopes to me). `Profissional 1` is the seeded colleague's display name.
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
    // Member-level surfaces stay: the operational Agenda link, plus the account
    // menu at the footer (Perfil/Privacidade moved into the Configurações modal
    // reached via this button — brief 0090, so there is no "Perfil" sidebar link).
    await expect(nav.getByRole('link', { name: 'Agenda' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Conta' })).toBeVisible()

    // Registration surfaces vanish (capability matrix keeps every canManage*
    // false), and the whole Cadastros + Administração sections drop out.
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
    // Direct navigation to a capability-gated surface bounces back to /agenda
    // (server-side `requireCapabilityPage` redirect — defense in depth beyond the
    // hidden nav link).
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

    // The "Cadastrar novo" customer toggle is gone (canRegisterCustomer=false).
    await expect(dialog.getByRole('button', { name: /Cadastrar novo/ })).toHaveCount(0)

    // The memberOperation <Select> offers ONLY the logged-in memberOperation. Open it
    // and assert the colleague ("Profissional 1") is not an option.
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
    // The seeded owner, demoted to receptionist — the operational superset that
    // does everything memberOperations do, for ALL of them.
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

    // The balcão sees BOTH memberOperation columns (no own-scope clamp).
    await expect(agenda.memberOperationColumn('Profissional 1')).toBeVisible()
    await expect(agenda.memberOperationColumn('Profissional Self')).toBeVisible()

    // …and keeps Clientes (receptionist preset grants canManageCustomers), while
    // still losing the org-admin Administração section.
    const nav = sidebar(page)
    await expect(nav.getByRole('link', { name: 'Clientes' })).toBeVisible()
    await expect(nav.getByText('Administração', { exact: true })).toHaveCount(0)
  })

  // #1268 — degraded fail-closed state: a self-scoped member whose
  // `member_operations` projection isn't provisioned yet (onboarding incomplete /
  // projection lag) resolves to the sentinel scope. The agenda reads come back
  // empty BY DESIGN; the surface must explain WHY (an actionable empty-state),
  // never a mute blank grid that reads as data loss — while never widening scope.
  test('agenda sem perfil operacional mostra empty-state explícito (não grid mudo)', async ({
    context,
    page,
    org,
    baseURL,
  }) => {
    // A loginable member_operator with NO member_operations projection → sentinel.
    const me = await seedLoginableMemberWithoutProfile(org.orgId, {
      displayName: 'Sem Perfil',
    })

    await signInAndAttachSession(context, me.email, me.password, baseURL ?? undefined)
    const agenda = new AgendaPage(page)
    await agenda.goto(APPT_DATE)

    // The explicit empty-state renders…
    await expect(page.getByText(/seu perfil de agenda ainda não está pronto/i)).toBeVisible()
    // …and the agenda grid (with its memberOperation columns) does NOT — no mute
    // blank surface, and fail-closed (no colleague column leaks through).
    await expect(agenda.memberOperationColumn('Profissional 1')).toHaveCount(0)
  })
})
