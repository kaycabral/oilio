// E2E — troca explícita de plano (ADR 0010, D5 / AC-07).
//
// Cobre os dois lados da decisão:
// 1. Editar o plano NÃO retroage no assinante ativo (o snapshot foi congelado
//    no create) E a tela de edição mostra a nota de UX exigida pelo ADR.
// 2. "Trocar plano" na assinatura É a ação explícita que move o assinante para
//    outro plano (captura snapshot fresco do destino).
//
// Seeding via REST (espelha baseline.spec.ts): dois planos ATIVOS + um cliente,
// no mesmo org, antes do fluxo de UI.

import { expect, test } from '../fixtures'
import { chooseOption, chooseOptionByIndex } from '../helpers/select'
import { seedCustomer, seedSubscriptionPlan } from '../helpers/session'

test.describe('Subscriptions — troca de plano (AC-07)', { tag: '@critical' }, () => {
  test('editar plano não retroage no assinante + nota de UX; trocar plano move', async ({
    org,
    authedPage,
  }) => {
    const ts = Date.now().toString()
    const planA = `Plano A ${ts}`
    const planB = `Plano B ${ts}`
    const planAId = seedSubscriptionPlan(org.orgId, { name: planA, priceCents: 10000 })
    seedSubscriptionPlan(org.orgId, { name: planB, priceCents: 25000 })
    seedCustomer(org.orgId)

    // Cria assinatura no Plano A (congela o snapshot do plano no create).
    await authedPage.goto('/subscriptions/new')
    await chooseOptionByIndex(authedPage, 'Cliente', 0)
    await chooseOption(authedPage, 'Plano', new RegExp(planA))
    await authedPage.getByRole('button', { name: 'Criar assinatura' }).click()
    // `/subscriptions/new` também casa `/subscriptions/.+`, então esperamos a
    // URL do detalhe (id != "new") antes de capturar.
    await expect(authedPage).toHaveURL(/\/subscriptions\/(?!new)[^/]+$/, { timeout: 10000 })
    const subUrl = authedPage.url()
    await expect(authedPage.getByRole('group', { name: 'Plano atual', exact: true })).toContainText(
      planA,
      {
        timeout: 5000,
      },
    )

    // (1) Editar o plano: a nota de UX exigida pelo ADR aparece.
    await authedPage.goto(`/plans/${planAId}`)
    await expect(authedPage.getByText(/Alterações valem só para novas assinaturas/)).toBeVisible()
    // Renomeia o plano (edição não deve retroagir no snapshot do assinante).
    const planARenamed = `${planA} EDITADO`
    await authedPage.locator('input[name="name"]').fill(planARenamed)
    await authedPage.getByRole('button', { name: 'Salvar' }).click()
    await expect(authedPage).toHaveURL(/\/plans(\?.*)?$/, { timeout: 10000 })

    // O assinante ativo mantém o snapshot congelado (nome ORIGINAL do Plano A),
    // não o nome editado — editar o plano não retroagiu.
    await authedPage.goto(subUrl)
    const summary = authedPage.getByRole('group', { name: 'Plano atual', exact: true })
    await expect(summary).toContainText(planA, { timeout: 5000 })
    await expect(summary).not.toContainText('EDITADO')

    // (2) Trocar plano explicitamente → snapshot fresco do Plano B.
    await chooseOption(authedPage, 'Plano de destino', new RegExp(planB))
    await authedPage.getByRole('button', { name: 'Trocar plano' }).click()

    // Agora o assinante reflete o Plano B (header mostra o novo plano + preço).
    await expect(summary).toContainText(planB, { timeout: 10000 })
    await expect(summary).toContainText('250,00')
  })
})
