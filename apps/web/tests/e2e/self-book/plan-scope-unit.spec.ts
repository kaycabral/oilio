// Feature-level E2E — brief 0019 Scenario 1 (unitAllowlist).
//
// Valida o § Definition of Done § Scenario 1 do brief 0019 — princípio
// canônico harness #11 (DoD é contrato) + #15 (parent issue tem sua PR
// Feature-level).
//
// Sub-issues granulares (#961 plan-edit UI + filter, #964 banner) já
// passaram em validação por unitário/integration. Este spec exercita
// journey end-to-end: assinante com plano restrito vs avulso, no mesmo
// org multi-unit, vendo telas diferentes.
//
// Scenario canonicamente declarado em [brief § DoD Scenario 1]
// (https://github.com/cbrl-dev/cbrl/wiki/08-Features-0019-regras-do-plano#scenario-1-plano-com-unitallowlist-filtra-self-book-do-assinante-critical):
//   Dado owner marca apenas 1 unidade em "Unidades cobertas",
//   Quando cliente com Subscription ativa daquele plano abre o self-book,
//   Então apenas a unidade marcada aparece pra escolha; outras unidades
//   públicas do org não aparecem; cliente avulso continua vendo todas.

import { expect, test } from '../fixtures'
import { seedCustomer, seedService, seedSubscription } from '../helpers/session'
import { PublicBookingPage, orgSlug } from '../pages'

test.describe(
  'brief 0019 — Feature-level DoD § Scenario 1 (unitAllowlist)',
  { tag: '@critical' },
  () => {
    test.use({ orgInput: { unitCount: 2, professionalCount: 1 } })

    test('plano com unitAllowlist filtra self-book do assinante; avulso vê todas', async ({
      org,
      authedPage,
      browser,
    }) => {
      const slug = orgSlug(org.orgId)
      const allowedUnitId = org.unitIds[0]!
      const blockedUnitId = org.unitIds[1]!

      // Service público em cada unidade — confirma que avulso vê as duas.
      seedService(org.orgId, {
        name: 'Corte Alvorada',
        publicVisible: true,
        unitIds: [allowedUnitId],
      })
      seedService(org.orgId, {
        name: 'Corte Djalma',
        publicVisible: true,
        unitIds: [blockedUnitId],
      })

      // Assinante = mesmo uid da sessão logada (org.uid). seedCustomer
      // sobrescreve o User stub mas isso é ok aqui — o teste não depende
      // dos campos do owner doc; só precisa que customerUserId === session.uid
      // pro resolveCustomerSubscriptionScope achar a subscription.
      const customerId = seedCustomer(org.orgId, {
        name: 'Cliente Scoped',
        userId: org.uid,
      })
      seedSubscription(org.orgId, customerId, {
        planName: 'Plano Alvorada Only',
        unitAllowlist: [allowedUnitId],
      })

      // (a) Assinante logado: catálogo multi-unit colapsa pra única unit
      // coberta — short-circuit pra UnitCatalog (vê só Corte Alvorada).
      const subscribed = new PublicBookingPage(authedPage, slug)
      await subscribed.gotoCatalog()
      await expect(authedPage.getByRole('heading', { name: /escolha uma unidade/i })).toHaveCount(0)
      await expect(authedPage.getByText('Corte Alvorada')).toBeVisible()
      await expect(authedPage.getByText('Corte Djalma')).toHaveCount(0)
      // Banner discreto (AC-16) confirma cobertura visível pro assinante.
      await expect(
        authedPage.getByRole('note', { name: 'Seu plano cobre', exact: true }),
      ).toBeVisible()

      // (b) Avulso (contexto novo, sem session): picker mostra as 2 unidades.
      const guestContext = await browser.newContext()
      const guestPage = await guestContext.newPage()
      const guest = new PublicBookingPage(guestPage, slug)
      await guest.gotoCatalog()
      await expect(guestPage.getByRole('heading', { name: /escolha uma unidade/i })).toBeVisible()
      await expect(guestPage.getByText('Unidade 1')).toBeVisible()
      await expect(guestPage.getByText('Unidade 2')).toBeVisible()
      // Avulso jamais vê o banner — só renderiza com scope-bearing session.
      await expect(
        guestPage.getByRole('note', { name: 'Seu plano cobre', exact: true }),
      ).toHaveCount(0)
      await guestContext.close()
    })
  },
)
