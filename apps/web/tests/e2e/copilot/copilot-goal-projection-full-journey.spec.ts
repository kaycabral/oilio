// Feature-level E2E — brief 0042 (Copiloto — Meta de lucro + projeção), parent
// #1113.
//
// Valida o § Definition of Done do brief — princípio canônico #11 (DoD é
// contrato) + #15 (parent issue tem sua PR Feature-level). As sub-issues #1114
// (meta CRUD) e #1115 (acompanhamento/projeção) já passaram em E2Es próprios;
// este spec cruza os componentes (form real → server action → read-model que lê
// order/commission/charge/subscription) numa jornada única, exercitando a
// fórmula COMPLETA do realizado — avulso + recorrente reconhecida − comissão —
// que os granulares só cobrem em pedaços, e o rótulo "parcial (após comissão)"
// (path sem cobertura E2E antes deste spec).
//
// Cenários canonicamente declarados em
// [brief § DoD](https://gitlab.com/cbrl/cbrl/-/wikis/Produto/Funcionalidades/0042-copiloto-meta-projecao):
//   - Cenário 1 [critical]: definir meta e acompanhar (unidade única)
//   - Cenário 3 [critical]: honestidade da medição parcial
//   - Cenário 4 [critical]: receita recorrente entra no realizado
//
// Cenário 2 (multi-unidade com rollup) está ❌ SUPERSEDED por 0045 (#1121): o
// Copiloto opera na unidade ativa sem rollup (#1120 removeu a visão agregada).
// O isolamento per-unit vive no spec do 0045 (`copilot-tracking.spec.ts`).

import { expect, test } from '../fixtures'
import { assertDefined } from '../helpers/rules'
import {
  seedClosedOrder,
  seedCommission,
  seedCustomer,
  seedPaidCharge,
  seedSubscription,
} from '../helpers/session'

test.describe(
  'brief 0042 — Feature-level DoD (Copiloto — meta de lucro + projeção)',
  { tag: '@journey' },
  () => {
    test.use({ orgInput: { unitCount: 1 } })

    // Cenário 1: o dono define a meta pelo fluxo real e vê o painel completo —
    // meta · realizado (avulso + recorrente reconhecida − comissão) · ritmo% ·
    // projeção run-rate. Exercita a fórmula inteira junta, com as três fontes.
    test('Cenário 1: definir meta e acompanhar (realizado avulso + recorrente − comissão)', async ({
      org,
      authedPage,
    }) => {
      const unitId = org.unitIds[0]
      assertDefined(unitId, 'expected a 1-unit org')
      const customerId = await seedCustomer(org.orgId, {})

      // Avulso: comanda fechada no mês → R$ 200 reconhecidos.
      const orderId = await seedClosedOrder({
        orgId: org.orgId,
        unitId,
        customerId,
        attributedUserId: org.uid,
        totalCents: 20000,
      })
      // Comissão ligada à comanda → R$ 50 subtraídos do realizado.
      await seedCommission({
        orgId: org.orgId,
        attributedUserId: org.uid,
        amountCents: 5000,
        orderId,
      })
      // Recorrente reconhecida: cobrança de assinatura liquidada no mês → R$ 300.
      // A cobrança é o registro de faturamento de uma assinatura real (FK
      // NOT NULL, #1220 D2).
      const subscriptionId = await seedSubscription(org.orgId, customerId, { unitId })
      await seedPaidCharge(org.orgId, {
        unitId,
        amountCents: 30000,
        paidAt: new Date().toISOString(),
        customerId,
        subscriptionId,
      })

      await authedPage.goto('/copilot')
      // Define a meta pelo formulário real (server action + emitEvent → projeção).
      await authedPage.getByLabel('Meta de lucro do mês (R$)').fill('5000')
      await authedPage.getByRole('button', { name: 'Definir meta' }).click()

      // Meta persistida e exibida.
      await expect(
        authedPage.getByRole('group', { name: 'Meta de lucro do mês', exact: true }),
      ).toContainText(/R\$\s*5\.000,00/)
      // Realizado = 200 (avulso) + 300 (recorrente) − 50 (comissão) = R$ 450,00.
      await expect(authedPage.getByRole('group', { name: 'Realizado', exact: true })).toContainText(
        /R\$\s*450,00/,
      )
      // Há vendas → a projeção run-rate deixa de ser n/d.
      await expect(
        authedPage.getByRole('group', {
          name: 'Projeção de fechamento (nesse ritmo)',
          exact: true,
        }),
      ).not.toContainText(/n\/d/)
    })

    // Cenário 3: sem custo de item/despesa cadastrados, o realizado é
    // resultado-após-comissão, ROTULADO como parcial — a UI não finge que é o
    // lucro fechado. Com comissão > 0, o rótulo honesto é "após comissão".
    test('Cenário 3: honestidade da medição parcial (rótulo após comissão, sem fingir lucro)', async ({
      org,
      authedPage,
    }) => {
      const unitId = org.unitIds[0]
      assertDefined(unitId, 'expected a 1-unit org')
      const customerId = await seedCustomer(org.orgId, {})

      // Avulso R$ 100 com comissão R$ 30 → realizado parcial = R$ 70.
      const orderId = await seedClosedOrder({
        orgId: org.orgId,
        unitId,
        customerId,
        attributedUserId: org.uid,
        totalCents: 10000,
      })
      await seedCommission({
        orgId: org.orgId,
        attributedUserId: org.uid,
        amountCents: 3000,
        orderId,
      })

      await authedPage.goto('/copilot')
      await authedPage.getByLabel('Meta de lucro do mês (R$)').fill('5000')
      await authedPage.getByRole('button', { name: 'Definir meta' }).click()

      // Realizado é o resultado-após-comissão (R$ 70), não o bruto (R$ 100).
      await expect(authedPage.getByRole('group', { name: 'Realizado', exact: true })).toContainText(
        /R\$\s*70,00/,
      )
      // Rótulo honesto: parcial, falta o custo — a UI não chama isso de lucro.
      await expect(
        authedPage.getByRole('group', { name: 'Parcialidade do realizado', exact: true }),
      ).toContainText('parcial (após comissão) — falta custo')
    })

    // Cenário 4: receita recorrente reconhecida (cobrança liquidada no período)
    // entra no realizado; o MRR aparece à parte como observação, NUNCA dentro do
    // realizado. Sem comissão (SaaS / produto-puro) → rótulo "só receita".
    test('Cenário 4: recorrente entra no realizado; MRR fica à parte', async ({
      org,
      authedPage,
    }) => {
      const unitId = org.unitIds[0]
      assertDefined(unitId, 'expected a 1-unit org')
      const customerId = await seedCustomer(org.orgId, {})

      // Assinatura ativa R$ 90/mês → MRR observado, fora do realizado.
      await seedSubscription(org.orgId, customerId, {
        unitId,
        priceCents: 9000,
        status: 'active',
      })
      // Cobrança de assinatura liquidada neste mês → R$ 300 recorrente reconhecido.
      await seedPaidCharge(org.orgId, {
        unitId,
        amountCents: 30000,
        paidAt: new Date().toISOString(),
        customerId,
      })

      await authedPage.goto('/copilot')
      await authedPage.getByLabel('Meta de lucro do mês (R$)').fill('5000')
      await authedPage.getByRole('button', { name: 'Definir meta' }).click()

      // Realizado = recorrente reconhecida (R$ 300), não o MRR.
      await expect(authedPage.getByRole('group', { name: 'Realizado', exact: true })).toContainText(
        /R\$\s*300,00/,
      )
      // Sem comissão → rótulo ainda mais explícito ("só receita").
      await expect(
        authedPage.getByRole('group', { name: 'Parcialidade do realizado', exact: true }),
      ).toContainText('só receita — falta todo o custo')
      // MRR à parte (R$ 90), separado do realizado.
      await expect(
        authedPage.getByRole('group', {
          name: 'MRR (observação — fora do realizado)',
          exact: true,
        }),
      ).toContainText(/R\$\s*90,00/)
    })
  },
)
