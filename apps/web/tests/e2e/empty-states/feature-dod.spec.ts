// Feature-level E2E for brief 0034 — "Empty-state protagonista" (parent #1071).
// One test() per Definition of Done scenario. The DoD is about the SHARED
// list-surface pattern (#1072 #1073), so the journey exercises it end-to-end on
// `/subscriptions` (the reference surface: it carries filter tabs + a real
// create flow, so it can reach all three states) and confirms the same chrome
// rule holds on a second surface (`/customers`) to prove it's shared, not
// per-page.
//
// DoD § brief 0034:
//   Cenário 1 — lista sem dados é protagonista (só EmptyState; header + filtros
//               + busca escondidos).
//   Cenário 2 — filtrado-vazio preserva o filtro (filtros permanecem + "nenhum
//               resultado"; NÃO o protagonista de criação).
//   Cenário 3 — com dados, chrome normal (header-CTA + filtros + lista).
//   Cenário 4 — sem superfície interativa prematura no vazio (1 CTA só; nada
//               que dispare evento à toa).
//   Baseline  — render+empty · fluxo real (criar pelo CTA → chrome reaparece) ·
//               dado degenerado (filtrado-vazio vs totalmente vazio).

import { expect, test } from '../fixtures'
import { chooseOptionByIndex } from '../helpers/select'
import { seedCustomer, seedSubscriptionPlan } from '../helpers/session'

test.describe('Empty-state protagonista — Feature DoD (brief 0034 · #1071)', () => {
  test('Cenário 1 — lista sem dados é protagonista (esconde header + filtros)', async ({
    authedPage,
  }) => {
    // Dado uma entidade sem nenhum registro (sem filtro aplicado)
    await authedPage.goto('/subscriptions')

    // Então aparece só o EmptyState com 1 CTA…
    await expect(authedPage.getByText('Nenhuma assinatura cadastrada')).toBeVisible()
    await expect(authedPage.getByRole('link', { name: 'Nova assinatura' })).toBeVisible()
    // …e o "Novo X" do header, o filtro de status e a busca NÃO aparecem.
    await expect(authedPage.getByRole('heading', { name: 'Assinaturas' })).toBeHidden()
    await expect(authedPage.getByRole('combobox', { name: 'Status' })).toBeHidden()
    await expect(authedPage.getByRole('searchbox')).toBeHidden()

    // É um padrão COMPARTILHADO: a mesma regra de chrome vale noutra surface.
    await authedPage.goto('/customers')
    await expect(authedPage.getByText('Nenhum cliente cadastrado')).toBeVisible()
    await expect(authedPage.getByRole('heading', { name: 'Clientes' })).toBeHidden()
  })

  test('Cenário 4 — sem superfície interativa prematura no vazio (1 CTA só)', async ({
    authedPage,
  }) => {
    // Dado uma tela vazia (sem dados), quando renderiza, não há form/ação
    // interativa além do CTA único.
    await authedPage.goto('/subscriptions')
    await expect(authedPage.getByText('Nenhuma assinatura cadastrada')).toBeVisible()

    // O protagonista vazio é o EmptyState (sem shell de toolbar/header em
    // volta). Exatamente 1 link (o CTA) e nenhum botão/aba dentro dele.
    const surface = authedPage.locator('[data-slot="empty-state"]')
    await expect(surface).toBeVisible()
    await expect(surface.getByRole('link')).toHaveCount(1)
    await expect(surface.getByRole('button')).toHaveCount(0)
  })

  test('Cenários 2 + 3 + Baseline — fluxo real: vazio → criar → chrome normal → filtrado-vazio', async ({
    org,
    authedPage,
  }) => {
    const ts = Date.now().toString()
    const planLabel = `Plano DoD ${ts}`
    seedSubscriptionPlan(org.orgId, { name: planLabel })
    seedCustomer(org.orgId)

    // Baseline (render+empty): começa protagonista.
    await authedPage.goto('/subscriptions')
    await expect(authedPage.getByText('Nenhuma assinatura cadastrada')).toBeVisible()

    // Baseline (fluxo real): criar pela ação real → chrome (header + filtros)
    // reaparece e o item aparece na lista.
    await authedPage.getByRole('link', { name: 'Nova assinatura' }).click()
    await expect(authedPage).toHaveURL(/\/subscriptions\/new$/)
    // Only one seeded customer (and it carries no materialized name), so pick
    // the first real option — what a user would do.
    await chooseOptionByIndex(authedPage, 'Cliente', 0)
    await authedPage.getByRole('button', { name: 'Criar assinatura' }).click()
    await expect(authedPage).toHaveURL(/\/subscriptions\/.+/)
    await expect(authedPage.getByText('Aguardando 1ª cobrança')).toBeVisible({ timeout: 5000 })

    // Cenário 3 — com dados, chrome normal (header-CTA + filtros + lista).
    await authedPage.goto('/subscriptions?status=open')
    await expect(authedPage.getByRole('heading', { name: 'Assinaturas' })).toBeVisible()
    // O filtro agora é um combobox "Status"; com `status=open` aplicado o
    // gatilho exibe a opção escolhida ("Em aberto").
    await expect(authedPage.getByRole('combobox', { name: 'Status' })).toHaveText('Em aberto')
    await expect(authedPage.getByText(planLabel)).toBeVisible({ timeout: 5000 })

    // Cenário 2 + dado degenerado — há dados, mas o recorte "Encerradas" = 0:
    // filtros permanecem + "nenhum resultado", e o protagonista NÃO assume.
    await authedPage.goto('/subscriptions?status=cancelled')
    await expect(authedPage.getByRole('heading', { name: 'Assinaturas' })).toBeVisible()
    await expect(authedPage.getByRole('combobox', { name: 'Status' })).toHaveText('Encerradas')
    await expect(authedPage.getByText(/nenhuma assinatura para/i)).toBeVisible()
    await expect(authedPage.getByText('Nenhuma assinatura cadastrada')).toBeHidden()
  })
})
