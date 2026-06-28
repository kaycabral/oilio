// Feature-level E2E — brief 0052 § Definition of Done (parent #1157, B2).
//
// B2 is a PURELY NOMINAL refactor on the critical path: it renames the symbols
// that say `service` but operate on `catalog_items` — the MemberOperation service
// FK list, the RBAC catalog-management permission, the agenda active-service
// loader, the public-services wrapper, and the public bundle's service slice —
// all to the `catalog*` vocabulary (see no-legacy-catalog-symbols.mjs for the
// exact before/after pairs). The PRD requires REAL E2E in the DoD because the
// renamed catalogServiceIds field decides WHO serves WHICH item (availability/
// booking) — a silent regression would break the agenda. This spec proves the
// renamed names still drive the same behavior, end-to-end, against the emulator.
//
// - Cenário 1 [critical]: booking by memberOperation uses catalogServiceIds —
//   availability lists/allocates the linked pro, drops a slot already taken.
// - Cenário 3 [critical]: commission by service still accrues identically after
//   the rename (close an order with a commissionable service → pending record).
// - Cenário 4 [critical]: zero legacy symbol remains (the lint guard passes).
//
// RBAC (Cenário 2) is proven by the rules integration suite
// (firestore-rules.integration.test.ts) under the renamed canManageCatalog
// gate — kept there because it asserts allow/deny against the emulator rules.

import { execFileSync } from 'node:child_process'

import { expect, test } from '../fixtures'
import { nextWeekday } from '../helpers/date'
import { choosePaymentMethod } from '../helpers/select'
import {
  linkMemberOperationToServices,
  seedAppointment,
  seedCustomer,
  seedService,
  skipOnPostgres,
} from '../helpers/session'
import { AgendaPage, PublicBookingPage, orgSlug } from '../pages'

test.describe('Feature 0052 — Definition of Done (renames de catálogo, B2)', () => {
  test.describe('Cenário 1 — booking por profissional usa catalogServiceIds', () => {
    test.use({ orgInput: { unitCount: 1, memberOperationCount: 1 } })

    test('availability lista/aloca o pro vinculado via catalogServiceIds e dropa slot tomado', async ({
      org,
      page,
    }) => {
      const unitId = org.unitIds[0]!
      const serviceId = await seedService(org.orgId, {
        name: 'Corte B2',
        durationMinutes: 30,
        priceCents: 5000,
        publicVisible: true,
        unitIds: [unitId],
      })
      // The link is written through the renamed field (updateMask.fieldPaths=
      // catalogServiceIds) — this is the rename under test driving availability.
      await linkMemberOperationToServices(org.orgId, org.memberOperationIds[0]!, [serviceId])

      const targetDate = nextWeekday('Wed')
      // Pre-take 09:00 BR (12:00 UTC) so that slot is dropped — proves the
      // renamed field still feeds allocation, not just rendering.
      const cust = await seedCustomer(org.orgId, { name: 'Tomado', whatsapp: '11900000001' })
      await seedAppointment({
        orgId: org.orgId,
        unitId,
        memberOperationId: org.memberOperationIds[0]!,
        customerId: cust,
        serviceId,
        startAt: `${targetDate}T12:00:00.000Z`,
        endAt: `${targetDate}T12:30:00.000Z`,
        status: 'scheduled',
      })

      const booking = new PublicBookingPage(page, orgSlug(org.orgId))
      await booking.gotoAvailability('unidade-1', { serviceId, from: targetDate })
      await expect(page.getByRole('heading', { name: /disponibilidade/i })).toBeVisible()

      // The linked pro's later slots stay available; the taken 09:00 is gone.
      await expect(page.getByText('09:30').first()).toBeVisible()
      await expect(page.getByText('10:00').first()).toBeVisible()
      await expect(page.getByText('09:00').first()).toHaveCount(0)
    })

    test('pro sem o serviço em catalogServiceIds é filtrado da disponibilidade', async ({
      org,
      page,
    }) => {
      const unitId = org.unitIds[0]!
      const serviceId = await seedService(org.orgId, {
        name: 'Barba B2',
        durationMinutes: 30,
        priceCents: 4000,
        publicVisible: true,
        unitIds: [unitId],
      })
      // Deliberately DO NOT link the memberOperation to the service. With an empty
      // catalogServiceIds, the pro must not be offered for this service.
      const booking = new PublicBookingPage(page, orgSlug(org.orgId))
      await booking.gotoAvailability('unidade-1', { serviceId, from: nextWeekday('Wed') })
      await expect(page.getByText(/sem horários disponíveis para este dia/i)).toBeVisible()
    })
  })

  test.describe('Cenário 3 — comissão por serviço calcula idêntico pós-rename', () => {
    test.use({
      orgInput: {
        unitCount: 1,
        memberOperationCount: 1,
        memberOperationOperationalStatus: 'operational',
        hasBusinessHours: true,
        slotMinutes: 30,
      },
    })

    // Consumes the service through closing a comanda — the `order` aggregate's
    // read-path is migrated by feature E (Onda 3), not the catalog-item pilot.
    // Covered on the Firestore backend; Postgres coverage lands with feature E.
    // Conditional registration (the repo bans `test.skip`).
    if (!skipOnPostgres())
      test('fechar comanda com serviço comissionável gera comissão pendente', async ({
        org,
        authedPage,
      }) => {
        const serviceId = await seedService(org.orgId, {
          name: 'Corte Comissão B2',
          durationMinutes: 30,
          priceCents: 6000,
          publicVisible: true,
          commission: { kind: 'percentage', value: 50 },
          unitIds: org.unitIds,
        })
        const customerName = `Cliente Com ${Date.now()}`
        const customerId = await seedCustomer(org.orgId, {
          name: customerName,
          whatsapp: '11955553333',
        })
        await seedAppointment({
          orgId: org.orgId,
          unitId: org.unitIds[0]!,
          memberOperationId: org.memberOperationIds[0]!,
          customerId,
          serviceId,
          startAt: '2026-09-09T17:00:00.000Z',
          endAt: '2026-09-09T17:30:00.000Z',
          status: 'scheduled',
          servicePriceCentsSnapshot: 6000,
          serviceDurationMinutesSnapshot: 30,
          commissionSnapshot: { kind: 'percentage', value: 50 },
        })

        const agenda = new AgendaPage(authedPage)
        await agenda.goto('2026-09-09')
        await authedPage.getByRole('button', { name: new RegExp(customerName) }).click()
        await authedPage.getByRole('button', { name: /Iniciar atendimento/ }).click()
        await expect(authedPage).toHaveURL(/\/orders\/.+/)

        // Total = serviço R$ 60,00; fecha com pix.
        await expect(authedPage.getByText('R$ 60,00').first()).toBeVisible()
        await choosePaymentMethod(authedPage, 'pix')
        await authedPage.getByRole('button', { name: /Fechar venda/ }).click()
        const dialog = authedPage.getByRole('dialog', { name: 'Confirmar fechamento' })
        await dialog.getByRole('button', { name: /Confirmar fechamento/ }).click()
        await expect(authedPage.getByText(/Fechada em/)).toBeVisible({ timeout: 5000 })

        // Commission accrued for the executing memberOperation — 50% of R$ 60,00.
        await authedPage.goto('/reports/commissions')
        await expect(authedPage.getByText('R$ 30,00').first()).toBeVisible({ timeout: 5000 })
      })
  })

  test('Cenário 4 — nenhum símbolo legado restante (guard de lint)', () => {
    // AC-09 is enforced cheaply by the no-legacy-catalog-symbols.mjs guard in
    // the lint job; this test re-asserts the same invariant as the DoD proof so
    // the feature gate is self-contained. Playwright runs with cwd =
    // apps/oilio/web, so the guard sits at scripts/. A non-zero exit (legacy
    // symbol found) throws with the offending lines; empty stdout = clean.
    const out = execFileSync('node', ['scripts/no-legacy-catalog-symbols.mjs'], {
      encoding: 'utf8',
    })
    expect(out).toBe('')
  })
})
