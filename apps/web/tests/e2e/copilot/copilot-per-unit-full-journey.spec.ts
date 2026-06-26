// Feature-level E2E — brief 0045 (Copiloto por unidade), parent #1121.
//
// Valida o § Definition of Done do brief — princípio canônico #11 (DoD é
// contrato) + #15 (parent issue tem sua PR Feature-level). A sub-issue #1122 já
// passou no E2E próprio (isolamento de `charge` per-unit em
// `copilot-tracking.spec.ts`); este spec cruza os componentes numa jornada
// multi-unidade com unidade ATIVA, cobrindo o que faltava end-to-end: o
// isolamento per-unit também do **avulso (`order`) e da comissão** — não só do
// charge — e o realizado completo da unidade ativa (avulso + recorrente −
// comissão), que é o contrato distintivo do 0045 sobre o 0042.
//
// Cenários canonicamente declarados em
// [brief § DoD](https://gitlab.com/cbrl/cbrl/-/wikis/Produto/Funcionalidades/0045-copiloto-por-unidade):
//   - Cenário 1 [critical]: acompanhamento na unidade ativa (sem agregado)
//   - Cenário 2 [critical]: recorrente (e avulso) per-unit — B não vaza em A
//   - Cenário 3 [critical]: honestidade da medição parcial

import { expect, test } from '../fixtures'
import { assertDefined } from '../helpers/rules'
import {
  seedClosedOrder,
  seedCommission,
  seedCustomer,
  seedPaidCharge,
  seedSubscription,
  setActiveUnitCookie,
} from '../helpers/session'

test.describe('brief 0045 — Feature-level DoD (Copiloto por unidade)', { tag: '@journey' }, () => {
  // Org multi-unidade: o contexto de unidade ativa é o ponto do 0045.
  test.use({ orgInput: { unitCount: 2 } })

  // Cenário 1: unidade A ativa, com avulso + recorrente + comissão de A. O
  // Copiloto mostra meta · realizado (avulso A + recorrente A − comissão A) ·
  // projeção — tudo de A, SEM opção de agregado (AC-03: rollup removido).
  test('Cenário 1: acompanhamento na unidade ativa (sem agregado)', async ({ org, authedPage }) => {
    const unitA = org.unitIds[0]
    assertDefined(unitA, 'expected a 2-unit org')
    const customerId = await seedCustomer(org.orgId, {})

    // Avulso de A: R$ 200, com comissão R$ 50.
    const orderA = await seedClosedOrder({
      orgId: org.orgId,
      unitId: unitA,
      customerId,
      attributedUserId: org.uid,
      totalCents: 20000,
    })
    await seedCommission({
      orgId: org.orgId,
      attributedUserId: org.uid,
      amountCents: 5000,
      orderId: orderA,
    })
    // Recorrente reconhecida de A: cobrança liquidada R$ 300. A cobrança é o
    // registro de faturamento de uma assinatura real (FK NOT NULL, #1220 D2).
    const subA1 = await seedSubscription(org.orgId, customerId, { unitId: unitA })
    await seedPaidCharge(org.orgId, {
      unitId: unitA,
      amountCents: 30000,
      paidAt: new Date().toISOString(),
      customerId,
      subscriptionId: subA1,
    })

    // Fixa A ativa sem passar pelo interstitial de seleção (org 2-unidades).
    await setActiveUnitCookie(authedPage.context(), unitA)
    await authedPage.goto('/copilot')
    await authedPage.getByLabel('Meta de lucro do mês (R$)').fill('5000')
    await authedPage.getByRole('button', { name: 'Definir meta' }).click()

    // Realizado de A = 200 (avulso) + 300 (recorrente) − 50 (comissão) = R$ 450.
    await expect(authedPage.getByRole('group', { name: 'Realizado', exact: true })).toContainText(
      /R\$\s*450,00/,
    )
    await expect(
      authedPage.getByRole('group', {
        name: 'Projeção de fechamento (nesse ritmo)',
        exact: true,
      }),
    ).not.toContainText(/n\/d/)
    // AC-03: sem superfície de agregado/consolidado no Copiloto.
    await expect(authedPage.getByText(/todas as unidades|consolidado|agregado/i)).toHaveCount(0)
  })

  // Cenário 2: A e B têm avulso E recorrente no mês. Com A ativa, o realizado
  // soma SÓ o que é de A (`order.unitId == A` e `charge.unitId == A`); nada de
  // B vaza. Guardrail contra rollup acidental no read-model — cobre o avulso
  // além do charge (o isolamento de charge já vive no spec da sub-issue).
  test('Cenário 2: avulso e recorrente per-unit (B não vaza em A)', async ({ org, authedPage }) => {
    const unitA = org.unitIds[0]
    const unitB = org.unitIds[1]
    assertDefined(unitA, 'expected a 2-unit org')
    assertDefined(unitB, 'expected a 2-unit org')
    const customerId = await seedCustomer(org.orgId, {})
    const paidAt = new Date().toISOString()

    // A: avulso R$ 100 + recorrente R$ 300 → realizado de A = R$ 400.
    await seedClosedOrder({
      orgId: org.orgId,
      unitId: unitA,
      customerId,
      attributedUserId: org.uid,
      totalCents: 10000,
    })
    // Cada cobrança é o registro de faturamento de uma assinatura real (FK
    // NOT NULL, #1220 D2) — uma assinatura por unidade.
    const subA2 = await seedSubscription(org.orgId, customerId, { unitId: unitA })
    await seedPaidCharge(org.orgId, {
      unitId: unitA,
      amountCents: 30000,
      paidAt,
      customerId,
      subscriptionId: subA2,
    })
    // B: avulso R$ 999 + recorrente R$ 500 → NÃO pode entrar no realizado de A.
    await seedClosedOrder({
      orgId: org.orgId,
      unitId: unitB,
      customerId,
      attributedUserId: org.uid,
      totalCents: 99900,
    })
    const subB2 = await seedSubscription(org.orgId, customerId, { unitId: unitB })
    await seedPaidCharge(org.orgId, {
      unitId: unitB,
      amountCents: 50000,
      paidAt,
      customerId,
      subscriptionId: subB2,
    })

    await setActiveUnitCookie(authedPage.context(), unitA)
    await authedPage.goto('/copilot')
    await authedPage.getByLabel('Meta de lucro do mês (R$)').fill('5000')
    await authedPage.getByRole('button', { name: 'Definir meta' }).click()

    // Realizado = só A (R$ 400). O consolidado seria R$ 1.899 (100+300+999+500).
    await expect(authedPage.getByRole('group', { name: 'Realizado', exact: true })).toContainText(
      /R\$\s*400,00/,
    )
    await expect(
      authedPage.getByRole('group', { name: 'Realizado', exact: true }),
    ).not.toContainText(/R\$\s*1\.899,00/)
  })

  // Cenário 3: sem custo cadastrado, o realizado da unidade ativa é
  // resultado-após-comissão, rotulado parcial — a UI não finge lucro fechado.
  test('Cenário 3: honestidade da medição parcial (rótulo após comissão)', async ({
    org,
    authedPage,
  }) => {
    const unitA = org.unitIds[0]
    assertDefined(unitA, 'expected a 2-unit org')
    const customerId = await seedCustomer(org.orgId, {})

    // Avulso de A R$ 100 com comissão R$ 30 → realizado parcial = R$ 70.
    const orderA = await seedClosedOrder({
      orgId: org.orgId,
      unitId: unitA,
      customerId,
      attributedUserId: org.uid,
      totalCents: 10000,
    })
    await seedCommission({
      orgId: org.orgId,
      attributedUserId: org.uid,
      amountCents: 3000,
      orderId: orderA,
    })

    await setActiveUnitCookie(authedPage.context(), unitA)
    await authedPage.goto('/copilot')
    await authedPage.getByLabel('Meta de lucro do mês (R$)').fill('5000')
    await authedPage.getByRole('button', { name: 'Definir meta' }).click()

    // Realizado é o resultado-após-comissão (R$ 70), não o bruto (R$ 100).
    await expect(authedPage.getByRole('group', { name: 'Realizado', exact: true })).toContainText(
      /R\$\s*70,00/,
    )
    await expect(
      authedPage.getByRole('group', { name: 'Parcialidade do realizado', exact: true }),
    ).toContainText('parcial (após comissão) — falta custo')
  })
})
