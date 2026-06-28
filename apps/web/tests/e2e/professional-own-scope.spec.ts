import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import {
  linkProfessionalToServices,
  seedAppointment,
  seedCustomer,
  seedLoginableProfessional,
  seedService,
  setMembershipRole,
  signInAndAttachSession,
} from './helpers/session'
import { AgendaPage } from './pages/AgendaPage'

// Brief 0075 (#1253) — DoD: a self-scoped professional only reaches their OWN
// data. These specs sign in AS the professional (a real auth user via
// `seedLoginableProfessional`, not the synthetic `e2e-prof-user-*`) and prove:
//   1. the agenda shows only their own column, never a colleague's;
//   2. the registration surfaces (Clientes/Catálogo/Planos/Assinaturas) and the
//      whole Administração section are gone from the nav;
//   3. the new-appointment dialog offers ONLY themselves in the professional
//      picker and hides the "Cadastrar novo" customer toggle;
//   4. the balcão (recepção) is the operational superset — it sees every
//      professional's column and keeps Clientes.
//
// Capability-gated, never role-branched: the same assertions would hold for any
// future custom role whose matrix matches the professional preset.

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
  // One unit, one seeded (colleague) professional named "Profissional 1". The
  // logged-in professional is the loginable one we add below.
  test.use({
    orgInput: {
      unitCount: 1,
      professionalCount: 1,
      professionalOperationalStatus: 'operational',
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
    const colleagueId = org.professionalIds[0]!
    // Shared bookable service, linked to my professional so it renders as an
    // operational column on the agenda (whatsapp ∧ ≥1 unit ∧ ≥1 service).
    const serviceId = await seedService(org.orgId, {
      name: 'Corte Own-Scope',
      publicVisible: true,
      unitIds: [unitId],
    })
    const me = await seedLoginableProfessional(org.orgId, {
      unitIds: [unitId],
      catalogServiceIds: [serviceId],
      displayName: 'Profissional Self',
    })
    await linkProfessionalToServices(org.orgId, colleagueId, [serviceId])
    const customer = await seedCustomer(org.orgId, { name: 'Cliente Teste' })

    // One appointment for me, one for the colleague — same unit, same day.
    await seedAppointment({
      orgId: org.orgId,
      unitId,
      professionalId: me.professionalId,
      customerId: customer,
      serviceId,
      startAt: ownStartUtc,
      endAt: ownEndUtc,
    })
    await seedAppointment({
      orgId: org.orgId,
      unitId,
      professionalId: colleagueId,
      customerId: customer,
      serviceId,
      startAt: otherStartUtc,
      endAt: otherEndUtc,
    })

    await signInAndAttachSession(context, me.email, me.password, baseURL ?? undefined)
    const agenda = new AgendaPage(page)
    await agenda.goto(APPT_DATE)

    // My own column renders…
    await expect(agenda.professionalColumn('Profissional Self')).toBeVisible()
    // …the colleague's column does not (RLS hides their row + the read layer
    // scopes to me). `Profissional 1` is the seeded colleague's display name.
    await expect(agenda.professionalColumn('Profissional 1')).toHaveCount(0)
  })

  test('nav esconde Cadastros, Administração e Assinaturas', async ({
    context,
    page,
    org,
    baseURL,
  }) => {
    const me = await seedLoginableProfessional(org.orgId, {
      unitIds: [org.unitIds[0]!],
      displayName: 'Profissional Self',
    })

    await signInAndAttachSession(context, me.email, me.password, baseURL ?? undefined)
    await page.goto('/agenda')
    await expect(page).toHaveURL(/\/agenda$/)

    const nav = sidebar(page)
    // Member-level surfaces stay.
    await expect(nav.getByRole('link', { name: 'Agenda' })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Perfil' })).toBeVisible()

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
    const me = await seedLoginableProfessional(org.orgId, {
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
    const me = await seedLoginableProfessional(org.orgId, {
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

    // The professional <Select> offers ONLY the logged-in professional. Open it
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
    // does everything professionals do, for ALL of them.
    await setMembershipRole(`${org.orgId}_${org.uid}`, 'receptionist')
    const unitId = org.unitIds[0]!
    const serviceId = await seedService(org.orgId, {
      name: 'Corte Balcão',
      publicVisible: true,
      unitIds: [unitId],
    })
    const me = await seedLoginableProfessional(org.orgId, {
      unitIds: [unitId],
      catalogServiceIds: [serviceId],
      displayName: 'Profissional Self',
    })
    expect(me.professionalId).toBeTruthy()

    await signInAndAttachSession(context, org.email, org.password, baseURL ?? undefined)
    const agenda = new AgendaPage(page)
    await agenda.goto(APPT_DATE)

    // The balcão sees BOTH professional columns (no own-scope clamp).
    await expect(agenda.professionalColumn('Profissional 1')).toBeVisible()
    await expect(agenda.professionalColumn('Profissional Self')).toBeVisible()

    // …and keeps Clientes (receptionist preset grants canManageCustomers), while
    // still losing the org-admin Administração section.
    const nav = sidebar(page)
    await expect(nav.getByRole('link', { name: 'Clientes' })).toBeVisible()
    await expect(nav.getByText('Administração', { exact: true })).toHaveCount(0)
  })
})
