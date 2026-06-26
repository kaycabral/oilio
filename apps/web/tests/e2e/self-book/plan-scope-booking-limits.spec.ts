// Feature-level E2E — brief 0019 Scenario 3 (bookingLimits anti-vaga-segurando).
//
// Valida o § Definition of Done § Scenario 3 do brief 0019 — princípio
// canônico harness #11 (DoD é contrato) + #15 (parent issue tem sua PR
// Feature-level).
//
// Sub-issues granulares (#963 plan-edit UI + enforcement + audit) já
// passaram em validação por unitário (`booking-limits.test.ts`). Este
// spec exercita journey end-to-end: assinante com plano `maxPerDay: 1`
// + appointment confirmado no dia tenta segundo via wizard, recebe modal
// de reagendamento sem criar novo doc.
//
// Scenario canonicamente declarado em [brief § DoD Scenario 3]
// (https://github.com/cbrl-dev/cbrl/wiki/08-Features-0019-regras-do-plano#scenario-3-booking-limit-anti-vaga-segurando-edge):
//   Dado plano `bookingLimits.maxPerDay: 1` + cliente com agendamento
//     confirmado no dia,
//   Quando mesmo cliente tenta criar segundo agendamento naquele dia,
//   Então sistema rejeita o segundo com modal de reagendamento; cliente
//     é direcionado a remarcar o primeiro.

import { expect, test } from '../fixtures'
import { nextWeekday } from '../helpers/date'
import {
  linkProfessionalToServices,
  seedAppointment,
  seedCustomer,
  seedService,
  seedSubscription,
} from '../helpers/session'
import { PublicBookingPage, orgSlug } from '../pages'

test.describe(
  'brief 0019 — Feature-level DoD § Scenario 3 (bookingLimits.maxPerDay)',
  { tag: '@critical' },
  () => {
    test.use({ orgInput: { unitCount: 1, professionalCount: 1 } })

    test('cliente com agendamento no dia + maxPerDay=1 → modal de reagendamento', async ({
      org,
      authedPage,
    }) => {
      const slug = orgSlug(org.orgId)
      const unitId = org.unitIds[0]!
      const professionalId = org.professionalIds[0]!
      const serviceId = await seedService(org.orgId, {
        name: 'Corte Limite',
        durationMinutes: 30,
        publicVisible: true,
        unitIds: [unitId],
      })
      await linkProfessionalToServices(org.orgId, professionalId, [serviceId])

      // Assinante = mesma session do org.uid pra customerUserId match.
      // Sememente o whatsapp pra que o upsertCustomerWithUser durante o
      // 2º booking encontre o mesmo User → mesmo customerId → existing
      // appointment é contado pelo checkBookingLimits.
      //
      // Whatsapp ÚNICO por run — `upsertCustomerWithUser` busca por
      // `users.where('whatsapp', '==', ...).limit(1)` e retorna o primeiro
      // match. Emulator persiste docs entre runs do spec → whatsapp
      // hardcoded gera colisão com Users de runs anteriores, fazendo o
      // upsert resolver pra User errado (sem Customer no org atual) e
      // criar um Customer novo. Resultado: appointment seedado fica
      // órfão pro `checkBookingLimits`, limit returns `ok`, 2º booking
      // é criado e o modal nunca aparece (bug #960 retroativo).
      // The confirmation form's PhoneInput masks to 11 local digits (DDD + 9-digit
      // mobile) and the server normalizes the submitted value before matching the
      // User by whatsapp. So the form input must be the 11-digit LOCAL number and
      // the seeded User must carry its NORMALIZED form (`55` + local). A 13-digit
      // raw seed truncated under the mask → normalized to a different value → the
      // upsert found no match, created a new customer, and the existing
      // appointment went uncounted (modal never appeared).
      const subscriberWhatsappLocal = `11988${String(Date.now()).slice(-6)}`
      const subscriberWhatsapp = `55${subscriberWhatsappLocal}`
      const customerId = await seedCustomer(org.orgId, {
        name: 'Cliente Limite',
        userId: org.uid,
        whatsapp: subscriberWhatsapp,
      })
      await seedSubscription(org.orgId, customerId, {
        planName: 'Plano Anti-Vaga',
        bookingLimits: { maxPerDay: 1 },
      })

      // Agenda primeiro appointment cedo no dia-alvo (Qua 09:00 local = 12:00 UTC
      // em America/Sao_Paulo, UTC-3 fixo desde 2019). Garantimos que o doc fica
      // no futuro (>today) — `nextWeekday('Wed')` é sempre amanhã ou depois.
      const targetDate = nextWeekday('Wed')
      const existingStart = `${targetDate}T12:00:00.000Z`
      const existingEnd = `${targetDate}T12:30:00.000Z`
      await seedAppointment({
        orgId: org.orgId,
        unitId,
        professionalId,
        customerId,
        serviceId,
        startAt: existingStart,
        endAt: existingEnd,
      })

      // Cliente acessa o wizard pra um segundo slot no mesmo dia (14:00 BR
      // = 17:00 UTC). Calendar continua mostrando o slot — bookingLimits
      // não filtra disponibilidade (avulso pode reservar lá); rejeição
      // acontece no commit.
      const proposedStart = `${targetDate}T17:00:00.000Z`
      const params = new URLSearchParams({
        service: serviceId,
        professional: professionalId,
        start: proposedStart,
      })
      const booking = new PublicBookingPage(authedPage, slug)
      await authedPage.goto(`/${slug}/unidade-1/book?${params.toString()}`)
      await expect(booking.confirmHeading()).toBeVisible()

      // `await seedCustomer({ userId })` reescreve o User stub com completionCompleted=false,
      // anulando o prefill do #864 — preenche manual. Submete → backend
      // detecta limit, devolve reschedule-required, UI abre modal.
      await booking.fillContact({
        name: 'Cliente Limite',
        whatsapp: subscriberWhatsappLocal,
      })
      await booking.confirmButton().click()
      const dialog = authedPage.getByRole('dialog', {
        name: /você já tem um agendamento neste dia/i,
      })
      await expect(dialog).toBeVisible()
      await expect(dialog.getByRole('link', { name: 'Reagendar' })).toHaveAttribute(
        'href',
        '/me/appointments',
      )

      // Não navegou pra success — modal interrompeu. URL ainda é /book.
      await expect(authedPage).toHaveURL(new RegExp(`/${slug}/unidade-1/book\\?`))
    })
  },
)
