import { expect, test } from './fixtures'
import { assertDefined } from './helpers/rules'
import {
  seedCustomer,
  seedPaidCharge,
  seedSubscription,
  setActiveUnitCookie,
} from './helpers/session'

// Brief 0042 (#1115) — acompanhamento, projeção e receita recorrente. O Copiloto
// opera na unidade ativa (brief 0045): sem rollup multi-unidade.
test.describe('Copiloto — acompanhamento & projeção', () => {
  test.use({ tenantInput: { unitCount: 1 } })

  // Cenário 1 (parte acompanhamento) + AC-05/AC-06 no caso degenerado: meta
  // definida, mês sem vendas → realizado R$ 0,00, projeção n/d (sem ÷0), e o
  // rótulo honesto "só receita — falta todo o custo" (sem comissão).
  test('meta sem vendas: realizado 0, projeção n/d, rótulo honesto', async ({ authedPage }) => {
    await authedPage.goto('/copilot')
    await authedPage.getByLabel('Meta de lucro do mês (R$)').fill('5000')
    await authedPage.getByRole('button', { name: 'Definir meta' }).click()

    await expect(
      authedPage.getByRole('group', { name: 'Meta de lucro do mês', exact: true }),
    ).toContainText(/R\$\s*5\.000,00/)
    await expect(authedPage.getByRole('group', { name: 'Realizado', exact: true })).toContainText(
      /R\$\s*0,00/,
    )
    await expect(
      authedPage.getByRole('group', { name: 'Projeção de fechamento (nesse ritmo)', exact: true }),
    ).toContainText(/n\/d — sem vendas ainda/)
    await expect(
      authedPage.getByRole('group', { name: 'Parcialidade do realizado', exact: true }),
    ).toContainText('só receita — falta todo o custo')
  })

  // Cenário 4 (AC-08): receita recorrente reconhecida (cobrança de assinatura
  // liquidada no período) entra no realizado; o MRR aparece à parte como
  // observação — nunca dentro do realizado.
  test('receita recorrente entra no realizado; MRR fica à parte', async ({
    authedPage,
    tenant,
  }) => {
    const unitId = tenant.unitIds[0]
    assertDefined(unitId, 'expected a 1-unit tenant')
    const customerId = seedCustomer(tenant.tenantId, {})
    // Assinatura ativa R$ 90/mês → MRR observado. NÃO entra no realizado.
    seedSubscription(tenant.tenantId, customerId, {
      unitId,
      priceCents: 9000,
      status: 'active',
    })
    // Cobrança de assinatura JÁ liquidada neste mês → R$ 300 recorrente reconhecido.
    seedPaidCharge(tenant.tenantId, {
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
    // Projeção deixa de ser n/d (há vendas a extrapolar).
    await expect(
      authedPage.getByRole('group', { name: 'Projeção de fechamento (nesse ritmo)', exact: true }),
    ).not.toContainText(/n\/d/)
    // MRR exibido à parte (R$ 90), separado do realizado.
    await expect(
      authedPage.getByRole('group', { name: 'MRR (observação — fora do realizado)', exact: true }),
    ).toContainText(/R\$\s*90,00/)
  })
})

// Brief 0045 (#1122) — Cenário 2 do DoD: a receita recorrente é per-unit. O
// realizado da unidade ativa soma SÓ as cobranças liquidadas dela
// (`charge.unitId == unidade ativa`); cobranças de outra unidade não vazam.
// Guardrail contra rollup acidental no read-model do Copiloto.
test.describe('Copiloto — isolamento por unidade (Cenário 2)', () => {
  test.use({ tenantInput: { unitCount: 2 } })

  test('recorrente de outra unidade NÃO entra no realizado da unidade ativa', async ({
    authedPage,
    tenant,
  }) => {
    const activeUnitId = tenant.unitIds[0]
    const otherUnitId = tenant.unitIds[1]
    assertDefined(activeUnitId, 'expected a 2-unit tenant')
    assertDefined(otherUnitId, 'expected a 2-unit tenant')
    const customerId = seedCustomer(tenant.tenantId, {})
    const paidAt = new Date().toISOString()

    // Cobrança liquidada na unidade ATIVA (A) → R$ 300 reconhecidos.
    seedPaidCharge(tenant.tenantId, {
      unitId: activeUnitId,
      amountCents: 30000,
      paidAt,
      customerId,
    })
    // Cobrança liquidada na OUTRA unidade (B) → R$ 500. NÃO pode entrar no
    // realizado de A (sem rollup).
    seedPaidCharge(tenant.tenantId, {
      unitId: otherUnitId,
      amountCents: 50000,
      paidAt,
      customerId,
    })

    // Unidade A ativa (mesma do mrr-per-unit, #1118): fixa o contexto sem
    // passar pelo interstitial de seleção do tenant multi-unidade.
    await setActiveUnitCookie(authedPage.context(), activeUnitId)
    await authedPage.goto('/copilot')
    await authedPage.getByLabel('Meta de lucro do mês (R$)').fill('5000')
    await authedPage.getByRole('button', { name: 'Definir meta' }).click()

    // Realizado = só a cobrança de A (R$ 300) — a de B (R$ 500) fica de fora,
    // logo NÃO é o consolidado R$ 800.
    await expect(authedPage.getByRole('group', { name: 'Realizado', exact: true })).toContainText(
      /R\$\s*300,00/,
    )
    await expect(
      authedPage.getByRole('group', { name: 'Realizado', exact: true }),
    ).not.toContainText(/R\$\s*800,00/)
  })
})
