// Feature-level E2E — brief 0019 Scenario 2 (allowedTimeScope).
//
// Valida o § Definition of Done § Scenario 2 do brief 0019 — princípio
// canônico harness #11 (DoD é contrato) + #15 (parent issue tem sua PR
// Feature-level).
//
// Sub-issues granulares (#962 plan-edit UI + filter + commit) já passaram
// em validação por unitário (`time-scope.test.ts`). Este spec exercita
// journey end-to-end: assinante com plano restrito vs avulso vendo
// availability grid diferente, e tentativa de commit fora do scope
// surfacing o WA CTA.
//
// Scenario canonicamente declarado em [brief § DoD Scenario 2]
// (https://github.com/cbrl-dev/cbrl/wiki/08-Features-0019-regras-do-plano#scenario-2-plano-com-horrio-restrito-filtra-slots-disponveis-critical):
//   Dado plano com dias seg-sex + horário 08:00-18:00 + janela 3 dias,
//   Quando assinante tenta agendar fora dessa janela,
//   Então slot não aparece como disponível; UI mostra "Fora do plano" +
//   sugestão de canal humano (WhatsApp).

import { expect, test } from '../fixtures'
import { nextWeekday } from '../helpers/date'
import {
  linkMemberOperationToServices,
  seedCustomerShadowForUser,
  seedService,
  seedSubscription,
} from '../helpers/session'
import { PublicBookingPage, orgSlug } from '../pages'

test.describe(
  'brief 0019 — Feature-level DoD § Scenario 2 (allowedTimeScope)',
  { tag: '@critical' },
  () => {
    test.use({ orgInput: { unitCount: 1, memberOperationCount: 1 } })

    test('plano com horário restrito filtra slots no calendar e bloqueia commit', async ({
      org,
      authedPage,
      browser,
    }) => {
      const slug = orgSlug(org.orgId)
      const unitId = org.unitIds[0]!
      const serviceId = await seedService(org.orgId, {
        name: 'Corte Tempo',
        durationMinutes: 30,
        publicVisible: true,
        unitIds: [unitId],
      })
      await linkMemberOperationToServices(org.orgId, org.memberOperationIds[0]!, [serviceId])

      // Plano restrito a seg-sex 09:00-10:00 (envelope ultra-estreito pra
      // tornar o filtro observável dentro de business hours do org
      // 09:00-18:00). Avulso vê todo o grid 09:00-18:00; assinante só vê
      // <10:00.
      // `seedCustomerShadowForUser` (not `seedCustomer`) preserves the owner's
      // completionCompleted=true — clobbering it would trip the #1275 gate.
      const customerId = await seedCustomerShadowForUser(org.orgId, org.uid)
      await seedSubscription(org.orgId, customerId, {
        planName: 'Plano Janela Curta',
        allowedTimeScope: {
          daysOfWeek: [1, 2, 3, 4, 5],
          hourRange: { start: '09:00', end: '10:00' },
        },
      })

      const targetDate = nextWeekday('Wed')

      // (a) Assinante: availability grid mostra apenas slots <10:00.
      const subscribed = new PublicBookingPage(authedPage, slug)
      await subscribed.gotoAvailability('unidade-1', { serviceId, from: targetDate })
      await expect(authedPage.getByText('09:00')).toBeVisible()
      // 11:00 está dentro de business hours mas fora do plano — não aparece.
      await expect(authedPage.getByText('11:00')).toHaveCount(0)
      await expect(authedPage.getByText('14:00')).toHaveCount(0)
      // Banner (AC-16) confirma cobertura no UI do assinante.
      await expect(
        authedPage.getByRole('note', { name: 'Seu plano cobre', exact: true }),
      ).toBeVisible()

      // (b) Avulso (contexto novo): mesmo grid mostra slots durante o dia
      // todo (sem filtro de plano).
      const guestContext = await browser.newContext()
      const guestPage = await guestContext.newPage()
      const guest = new PublicBookingPage(guestPage, slug)
      await guest.gotoAvailability('unidade-1', { serviceId, from: targetDate })
      await expect(guestPage.getByText('09:00')).toBeVisible()
      await expect(guestPage.getByText('14:00')).toBeVisible()
      await guestContext.close()

      // (c) Defense-in-depth: assinante tenta confirmar via URL direta um
      // start fora do scope (14:00 local). Backend rejeita com
      // `out-of-scope` e UI mostra "Falar no WhatsApp" CTA.
      const outOfScopeStart = buildLocalIso(targetDate, '14:00', org.orgId)
      const params = new URLSearchParams({
        service: serviceId,
        memberOperation: org.memberOperationIds[0]!,
        start: outOfScopeStart,
      })
      await authedPage.goto(`/${slug}/unidade-1/book?${params.toString()}`)
      // No PII to type (#1275) — one-click confirm. O que importa pro DoD é o
      // resultado do submit (out-of-scope notice + WA CTA).
      await subscribed.confirmButton().click()
      await expect(authedPage.getByRole('link', { name: 'Falar no WhatsApp' })).toBeVisible()
    })
  },
)

// Converte (YYYY-MM-DD, HH:mm) em America/Sao_Paulo (tz default do seedOrg)
// pra ISO UTC. Sem dep de DST runtime — São Paulo está em UTC-3 desde 2019
// (DST abolido), suficiente pra E2E determinístico.
function buildLocalIso(dateYmd: string, hhmm: string, _orgId: string): string {
  // orgId param reservado pra futuras evoluções (tz por org); seedOrg
  // hoje fixa America/Sao_Paulo, então UTC = local + 3h.
  const [hh, mm] = hhmm.split(':')
  if (hh === undefined || mm === undefined) {
    throw new Error(`invalid HH:mm time: ${hhmm}`)
  }
  const localHour = Number(hh)
  const utcHour = (localHour + 3) % 24
  return `${dateYmd}T${String(utcHour).padStart(2, '0')}:${mm}:00.000Z`
}
