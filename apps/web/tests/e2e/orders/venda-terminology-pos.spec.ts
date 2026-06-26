// Brief 0030 (#1058) — terminologia neutra "Venda" + conveniências de POS.
//
// AC-09 [critical]: a navegação e o fluxo de venda falam "Venda" (não
// "Comanda"). O item de nav é "Vendas", a lista tem heading "Vendas" e o
// detalhe da venda usa "Venda"/"venda" em breadcrumb, botões e diálogos.
//
// AC-10 [edge]: conveniências de POS no add-item — busca rápida por nome OU
// código (SKU) filtra o seletor do catálogo, e os steppers (− / +) ajustam a
// quantidade da linha adicionada.

import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures'
import { chooseOption } from '../helpers/select'
import { seedProduct, seedService } from '../helpers/session'

const sidebar = (page: Page) => page.locator('[data-sidebar="content"]')

test.describe('Venda — terminologia neutra + POS (brief 0030, #1058)', () => {
  test.use({
    orgInput: {
      unitCount: 1,
      professionalCount: 1,
      professionalOperationalStatus: 'operational',
    },
  })

  test('AC-09: nav e lista falam "Vendas"; detalhe fala "Venda"', async ({ authedPage }) => {
    await authedPage.goto('/orders')

    // Nav: o item operacional é "Vendas" (antes "Comandas").
    await expect(sidebar(authedPage).getByRole('link', { name: 'Vendas' })).toBeVisible()
    await expect(sidebar(authedPage).getByRole('link', { name: 'Comandas' })).toHaveCount(0)

    // Lista vazia: protagonist empty-state neutro (brief 0034 / #1073) — header
    // escondido, EmptyState com o CTA único "Nova venda".
    await expect(authedPage.getByText('Nenhuma venda registrada')).toBeVisible()
    await expect(authedPage.getByRole('heading', { name: 'Vendas' })).toBeHidden()

    // Detalhe: abre uma venda avulsa e confere a cópia neutra.
    await authedPage.getByRole('button', { name: 'Nova venda' }).click()
    await expect(authedPage).toHaveURL(/\/orders\/.+/)
    await expect(authedPage.getByRole('link', { name: '← Vendas' })).toBeVisible()
    await expect(authedPage.getByRole('button', { name: 'Cancelar venda' })).toBeVisible()
    // Sem "Comanda"/"Comandas" em lugar nenhum da tela.
    await expect(authedPage.getByText(/Comanda/)).toHaveCount(0)
  })

  test('AC-10: busca rápida por nome OU código filtra o seletor do catálogo', async ({
    org,
    authedPage,
  }) => {
    await seedProduct(org.orgId, { name: 'Cimento CP-II', priceCents: 3000, sku: 'CIM-01' })
    await seedProduct(org.orgId, { name: 'Areia média', priceCents: 1500, sku: 'ARE-02' })

    await authedPage.goto('/orders')
    await authedPage.getByRole('button', { name: 'Nova venda' }).click()
    await expect(authedPage).toHaveURL(/\/orders\/.+/)

    const search = authedPage.getByRole('searchbox', { name: 'Buscar item do catálogo' })
    const picker = authedPage.getByRole('combobox', { name: 'Item do catálogo' })

    // The Radix combobox renders its options (role="option") in a portal only
    // while open, so each filter assertion opens the picker, counts, then closes
    // it (Escape) before the next search — the open listbox traps focus.
    const option = (name: string) => authedPage.getByRole('option', { name })
    async function optionCount(name: string): Promise<number> {
      await picker.click()
      const n = await option(name).count()
      await authedPage.keyboard.press('Escape')
      return n
    }

    // Sem busca: os dois produtos estão disponíveis.
    expect(await optionCount('Cimento CP-II')).toBe(1)
    expect(await optionCount('Areia média')).toBe(1)

    // Busca por nome (acento-insensível): só "Areia média" sobra.
    await search.fill('areia')
    expect(await optionCount('Areia média')).toBe(1)
    expect(await optionCount('Cimento CP-II')).toBe(0)

    // Busca por código (SKU): "CIM" filtra só o Cimento.
    await search.fill('CIM')
    expect(await optionCount('Cimento CP-II')).toBe(1)
    expect(await optionCount('Areia média')).toBe(0)
  })

  test('AC-10: steppers ajustam a quantidade da linha adicionada', async ({ org, authedPage }) => {
    // Produto a R$ 10,00 — quantidade 3 ⇒ linha R$ 30,00.
    await seedProduct(org.orgId, { name: 'Parafuso', priceCents: 1000, sku: 'PAR-01' })

    await authedPage.goto('/orders')
    await authedPage.getByRole('button', { name: 'Nova venda' }).click()
    await expect(authedPage).toHaveURL(/\/orders\/.+/)

    // Seleciona o produto e ajusta quantidade pra 3 via stepper (+ duas vezes).
    await chooseOption(authedPage, 'Item do catálogo', 'Parafuso')

    const qty = authedPage.getByRole('spinbutton', { name: 'Quantidade' })
    await expect(qty).toHaveValue('1')
    await authedPage.getByRole('button', { name: 'Aumentar quantidade' }).click()
    await authedPage.getByRole('button', { name: 'Aumentar quantidade' }).click()
    await expect(qty).toHaveValue('3')

    await authedPage.getByRole('button', { name: 'Adicionar item' }).click()

    // A linha entra com qty 3 e total R$ 30,00.
    await expect(authedPage.getByText('Parafuso', { exact: true })).toBeVisible()
    await expect(authedPage.getByText(/3 × R\$\s*10,00/)).toBeVisible()
    await expect(authedPage.getByText('R$ 30,00').first()).toBeVisible()
  })

  test('AC-10: serviço trava qty em 1 (steppers + input desabilitados)', async ({
    org,
    authedPage,
  }) => {
    // Regressão: o ajuste de quantidade não pode afrouxar a regra de serviço
    // (linha de serviço é sempre qty 1 — duração/comissão são por execução).
    await seedService(org.orgId, { name: 'Corte', durationMinutes: 30, priceCents: 5000 })

    await authedPage.goto('/orders')
    await authedPage.getByRole('button', { name: 'Nova venda' }).click()
    await expect(authedPage).toHaveURL(/\/orders\/.+/)

    // Steppers/quantidade habilitados antes de escolher.
    const qty = authedPage.getByRole('spinbutton', { name: 'Quantidade' })
    const inc = authedPage.getByRole('button', { name: 'Aumentar quantidade' })

    // Ao escolher um serviço, o ajuste de quantidade trava em 1.
    await chooseOption(authedPage, 'Item do catálogo', 'Corte')

    await expect(qty).toBeDisabled()
    await expect(inc).toBeDisabled()
    await expect(qty).toHaveValue('1')
  })
})
